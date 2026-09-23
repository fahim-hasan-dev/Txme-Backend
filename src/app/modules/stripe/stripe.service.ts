import stripe from '../../../config/stripe';
import { User } from '../user/user.model';
import ApiError from '../../../errors/ApiErrors';
import { StatusCodes } from 'http-status-codes';
import Stripe from 'stripe';
import { WalletService } from '../wallet/wallet.service';
import { Appointment } from '../appointment/appointment.model';
import { NotificationService } from '../notification/notification.service';
import config from '../../../config';
import { emitAppointmentUpdate } from '../../../util/appointment.util';
import { checkCardPaymentSetting, checkWalletSetting } from '../../../helpers/checkSetting';
import { WalletTransaction } from '../transaction/transaction.model';
import { IWalletTransaction } from '../transaction/transaction.interface';
import { delCache, getCache, setCache } from '../../../helpers/redisHelper';
import { getOrCreateStripeCustomer } from '../../../helpers/stripeHelper';
import { getStripeCountryCode } from '../../../util/getStripeCountryCode';

const createTopUpPaymentIntent = async (
    userId: string,
    amount: number,
    userEmail: string
): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    checkoutUrl: string;
    returnUrl: string;
}> => {
    await checkWalletSetting('topUp');

    try {
        const amountInCents = Math.round(amount * 100);

        // PaymentIntent for Payment Element
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'eur',

            automatic_payment_methods: {
                enabled: true,
            },

            metadata: {
                userId,
                type: 'wallet_topup',
                amount: amount.toString(),
            },

            receipt_email: userEmail,
            description: `Wallet Top Up - ${amount}`,
        });

        const successUrl =
            config.stripe.paymentSuccess ||
            'https://txme.app/payment-success';

        const customerId = await getOrCreateStripeCustomer(userEmail);

        // Checkout Session for Hosted Checkout
        const checkoutSession = await stripe.checkout.sessions.create({
            mode: 'payment',

            customer: customerId,

            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: 'Wallet Top Up',
                        },
                        unit_amount: amountInCents,
                    },
                    quantity: 1,
                },
            ],

            metadata: {
                userId,
                type: 'wallet_topup',
                amount: amount.toString(),
            },

            payment_intent_data: {
                metadata: {
                    userId,
                    type: 'wallet_topup',
                    amount: amount.toString(),
                },
            },

            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${successUrl}?canceled=true`,
        });

        return {
            // Keep existing response exactly the same
            clientSecret: paymentIntent.client_secret as string,
            paymentIntentId: paymentIntent.id,
            checkoutUrl: checkoutSession.url as string,
            returnUrl: 'txme://app/payment-status',
        };
    } catch (error: any) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Stripe payment creation failed: ${error.message}`
        );
    }
};

const handleSuccessfulTopUpPayment = async (
    paymentIntent: Stripe.PaymentIntent
): Promise<void> => {
    const metadata = paymentIntent.metadata || {};
    const userId = metadata.userId;

    if (!userId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid payment metadata: userId missing');
    }

    let netAmount: number | null = null;
    let chargeId: string | null = null;

    if (paymentIntent.latest_charge) {
        chargeId = typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge.id;
    }

    // If latest_charge is not yet on the object or balance_transaction is missing, fetch fresh PaymentIntent
    if (!chargeId) {
        try {
            const freshPi = await stripe.paymentIntents.retrieve(paymentIntent.id, {
                expand: ['latest_charge.balance_transaction']
            });
            if (freshPi.latest_charge) {
                if (typeof freshPi.latest_charge === 'string') {
                    chargeId = freshPi.latest_charge;
                } else {
                    chargeId = freshPi.latest_charge.id;
                    const bt = freshPi.latest_charge.balance_transaction;
                    if (bt && typeof bt === 'object' && typeof bt.net === 'number') {
                        netAmount = bt.net / 100;
                    }
                }
            }
        } catch (e: any) {
            console.error(`[StripeService] Failed to retrieve fresh PaymentIntent:`, e?.message);
        }
    }

    // Retrieve charge and balance_transaction with retry to ensure Stripe fee is deducted
    if (!netAmount && chargeId) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const charge = await stripe.charges.retrieve(chargeId, {
                    expand: ['balance_transaction']
                });

                if (charge.balance_transaction) {
                    if (typeof charge.balance_transaction === 'object' && typeof charge.balance_transaction.net === 'number') {
                        netAmount = charge.balance_transaction.net / 100;
                        console.log(`[StripeService] Net amount found via expanded charge: €${netAmount} (Fee: €${(charge.balance_transaction.fee || 0) / 100})`);
                        break;
                    } else if (typeof charge.balance_transaction === 'string') {
                        const bt = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
                        if (typeof bt.net === 'number') {
                            netAmount = bt.net / 100;
                            console.log(`[StripeService] Net amount found via balanceTransaction retrieve: €${netAmount} (Fee: €${(bt.fee || 0) / 100})`);
                            break;
                        }
                    }
                }

                // Fallback: query balance transactions list for this charge
                const btList = await stripe.balanceTransactions.list({ source: chargeId, limit: 1 });
                if (btList.data.length > 0 && typeof btList.data[0].net === 'number') {
                    netAmount = btList.data[0].net / 100;
                    console.log(`[StripeService] Net amount found via balanceTransactions.list: €${netAmount}`);
                    break;
                }
            } catch (error: any) {
                console.error(`[StripeService] Attempt ${attempt} failed to retrieve balance_transaction for ${paymentIntent.id}:`, error?.message);
            }

            if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    // If net amount could not be resolved yet, throw error so Stripe webhook retries in 1 minute
    if (netAmount === null || netAmount <= 0) {
        console.error(`❌ [StripeService] CRITICAL: Unable to resolve net amount for PaymentIntent ${paymentIntent.id}. Triggering webhook retry.`);
        throw new ApiError(
            StatusCodes.SERVICE_UNAVAILABLE,
            `Stripe balance transaction pending for ${paymentIntent.id}. Webhook will retry.`
        );
    }

    const grossAmount = Math.round(((parseFloat(metadata.amount || '0') || (paymentIntent.amount / 100)) + Number.EPSILON) * 100) / 100;
    const roundedNetAmount = Math.round((netAmount + Number.EPSILON) * 100) / 100;
    const feeAmount = Math.round((grossAmount - roundedNetAmount + Number.EPSILON) * 100) / 100;

    console.log(`[StripeService] Crediting user ${userId} wallet: Amount €${grossAmount}, Fee €${feeAmount}, NET €${roundedNetAmount} (Reference: ${paymentIntent.id})`);
    await WalletService.topUp(userId, grossAmount, paymentIntent.id, {
        fee: feeAmount,
        netAmount: roundedNetAmount
    });
};

const verifyTopUpPayment = async (
    paymentIntentId: string
): Promise<{ status: string; amount: number; transaction?: IWalletTransaction | null }> => {
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Find the transaction record using the paymentIntentId as reference
        const transaction = await WalletTransaction.findOne({ reference: paymentIntentId });

        return {
            status: paymentIntent.status,
            amount: transaction ? transaction.amount : paymentIntent.amount / 100,
            transaction: transaction || null
        };
    } catch (error: any) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Failed to verify payment: ${error.message}`
        );
    }
};


const createExpressAccount = async (userId: string, email: string) => {
    const user = await User.findById(userId);
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

    const targetCountry = getStripeCountryCode(user.countryOfResidence);

    if (user.stripeAccountId) {
        try {
            const existingAccount = await stripe.accounts.retrieve(user.stripeAccountId);
            
            // If onboarding is incomplete and country does not match user's current target country, reset to re-create
            if (!existingAccount.details_submitted && existingAccount.country !== targetCountry) {
                console.log(`[StripeService] Saved stripeAccountId ${user.stripeAccountId} has country ${existingAccount.country} but target is ${targetCountry}. Clearing and re-creating.`);
                user.stripeAccountId = undefined;
                user.isStripeConnected = false;
                await user.save();
            } else {
                return user.stripeAccountId;
            }
        } catch (error: any) {
            // If the account does not exist or belongs to another platform (not connected), clear it and create a new one
            if (error.raw?.type === 'invalid_request_error' || error.statusCode === 400 || error.message?.includes('not connected') || error.message?.includes('does not exist')) {
                console.log(`[StripeService] Saved stripeAccountId ${user.stripeAccountId} is invalid or not connected. Clearing and creating a new one.`);
                user.stripeAccountId = undefined;
                user.isStripeConnected = false;
                await user.save();
            } else {
                throw error;
            }
        }
    }

    // Prepare pre-filled data for Stripe
    const individual: Stripe.AccountCreateParams.Individual = {};

    if (user.email) individual.email = user.email;
    // Skip phone pre-fill to avoid Stripe regional format errors. User enters it during onboarding.
    // if (user.phone) {
    //     individual.phone = user.phone.startsWith('+') ? user.phone : `+${user.phone}`;
    // }

    if (user.fullName) {
        const nameParts = user.fullName.trim().split(/\s+/);
        if (nameParts.length > 0) {
            individual.first_name = nameParts[0];
            if (nameParts.length > 1) {
                individual.last_name = nameParts.slice(1).join(' ');
            }
        }
    }

    if (user.dateOfBirth) {
        const dob = new Date(user.dateOfBirth);
        individual.dob = {
            day: dob.getUTCDate(),
            month: dob.getUTCMonth() + 1,
            year: dob.getUTCFullYear(),
        };
    }

    if (user.gender) {
        const gender = user.gender.toLowerCase();
        if (gender === 'male' || gender === 'female') {
            individual.gender = gender;
        }
    }

    if (user.residentialAddress?.address) {
        individual.address = {
            line1: user.residentialAddress.address,
            city: user.residentialAddress.city || undefined,
            postal_code: user.residentialAddress.postCode || undefined,
            country: targetCountry,
        };
    }

    const account = await stripe.accounts.create({
        type: 'express',
        country: targetCountry,
        email: email,
        capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
        },
        individual: Object.keys(individual).length > 0 ? individual : undefined,
        business_type: 'individual',
    });

    user.stripeAccountId = account.id;
    await user.save();
    await delCache(`cache:stripe:status:${userId}`);
    await delCache(`cache:user:profile:${userId}`);

    return account.id;
};

const getAccount = async (stripeAccountId: string) => {
    return await stripe.accounts.retrieve(stripeAccountId);
};

const handleAccountUpdate = async (account: Stripe.Account) => {
    if (account.details_submitted) {
        const user = await User.findOne({ stripeAccountId: account.id });
        if (user) {
            user.isStripeConnected = true;
            await user.save();
            await delCache(`cache:stripe:status:${user._id.toString()}`);
            await delCache(`cache:user:profile:${user._id.toString()}`);
        }
    }
};

const createTransfer = async (amount: number, destinationAccountId: string, metadata: any) => {
    return await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: 'eur',
        destination: destinationAccountId,
        metadata
    });
};

const createPayout = async (amount: number, stripeAccountId: string) => {
    return await stripe.payouts.create(
        {
            amount: Math.round(amount * 100),
            currency: 'eur',
        },
        {
            stripeAccount: stripeAccountId,
        }
    );
};

const createAppointmentPaymentIntent = async (
    appointmentId: string,
    userEmail: string
): Promise<{ clientSecret: string; paymentIntentId: string; checkoutUrl: string; returnUrl: string }> => {
    await checkCardPaymentSetting();
    try {
        const appointment = await Appointment.findById(appointmentId).populate('provider');
        if (!appointment) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Appointment not found");
        }

        const provider = await User.findById(appointment.provider);
        if (!provider) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Provider not found");
        }

        if (!provider.isStripeConnected || !provider.stripeAccountId) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Provider has not connected their Stripe account yet. Payment cannot be processed."
            );
        }

        if (appointment.status !== 'awaiting_payment') {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                `Payment not allowed for appointment in ${appointment.status} status`
            );
        }

        if (!appointment.totalCost || appointment.totalCost <= 0) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid appointment cost");
        }

        const amountInCents = Math.round(appointment.totalCost * 100);

        let paymentIntentParams: Stripe.PaymentIntentCreateParams = {
            amount: amountInCents,
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            metadata: {
                appointmentId: appointmentId.toString(),
                type: 'appointment_payment',
                totalCost: appointment.totalCost.toString(),
            },
            receipt_email: userEmail,
            description: `Appointment Payment - ${appointmentId}`,
        };

        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

        const successUrl =
            config.stripe.paymentSuccess ||
            "https://txme.app/payment-success";

        const customerId = await getOrCreateStripeCustomer(userEmail);

        let checkoutSessionParams: Stripe.Checkout.SessionCreateParams = {
            // Removed payment_method_types: ['card']
            // Stripe will now use eligible payment methods
            mode: 'payment',
            customer: customerId,
            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Appointment Payment - ${appointmentId}`,
                        },
                        unit_amount: amountInCents,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                appointmentId: appointmentId.toString(),
                type: 'appointment_payment',
                totalCost: appointment.totalCost.toString(),
            },
            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${successUrl}?canceled=true`,
        };

        const checkoutSession = await stripe.checkout.sessions.create(
            checkoutSessionParams
        );

        return {
            clientSecret: paymentIntent.client_secret as string,
            paymentIntentId: paymentIntent.id,
            checkoutUrl: checkoutSession.url as string,
            returnUrl: "txme://app/payment-status"
        };
    } catch (error: any) {
        if (error instanceof ApiError) throw error;

        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Stripe payment creation failed: ${error.message}`
        );
    }
};

const handleSuccessfulAppointmentPayment = async (
    paymentIntent: Stripe.PaymentIntent
): Promise<void> => {
    const { appointmentId } = paymentIntent.metadata;

    if (!appointmentId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid payment metadata: appointmentId missing');
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Appointment not found");
    }

    appointment.status = 'review_pending';
    await appointment.save();

    // Calculate exact net amount after Stripe fees & taxes
    let netAmount: number = appointment.totalCost || 0;
    try {
        if (paymentIntent.latest_charge) {
            const chargeId = typeof paymentIntent.latest_charge === 'string'
                ? paymentIntent.latest_charge
                : paymentIntent.latest_charge.id;

            const charge = await stripe.charges.retrieve(chargeId, {
                expand: ['balance_transaction']
            });

            if (charge.balance_transaction && typeof charge.balance_transaction !== 'string') {
                const balanceTx = charge.balance_transaction as Stripe.BalanceTransaction;
                if (typeof balanceTx.net === 'number') {
                    netAmount = balanceTx.net / 100;
                }
            }
        }
    } catch (err: any) {
        console.error(`[StripeService] Failed to retrieve balance_transaction for appointment ${appointmentId}:`, err?.message);
    }

    // Perform Stripe Transfer of exact net amount to Provider's Connected Account
    const provider = await User.findById(appointment.provider);
    if (provider && provider.isStripeConnected && provider.stripeAccountId) {
        try {
            await createTransfer(netAmount, provider.stripeAccountId, {
                type: 'appointment_payment',
                appointmentId: appointmentId.toString()
            });
            console.log(`[StripeService] Transferred net amount ${netAmount} to provider ${provider.stripeAccountId}`);
        } catch (transferErr: any) {
            console.error(`[StripeService] Transfer to provider failed for appointment ${appointmentId}:`, transferErr?.message);
        }
    }

    // Create transaction records for history and invoice tracking
    const existingTransaction = await WalletTransaction.findOne({
        reference: appointment._id.toString(),
        type: "payment"
    });

    if (!existingTransaction) {
        const customerWallet = await WalletService.getOrCreateWallet(appointment.customer.toString());
        const providerWallet = await WalletService.getOrCreateWallet(appointment.provider.toString());

        await WalletTransaction.create([
            {
                wallet: customerWallet._id,
                amount: appointment.totalCost,
                type: "payment",
                direction: "debit",
                status: "success",
                from: appointment.customer,
                to: appointment.provider,
                reference: appointment._id.toString(),
                appointment: appointment._id
            },
            {
                wallet: providerWallet._id,
                amount: netAmount,
                type: "payment",
                direction: "credit",
                status: "success",
                from: appointment.customer,
                to: appointment.provider,
                reference: appointment._id.toString(),
                appointment: appointment._id
            }
        ]);
    }

    // Notify Provider
    console.log(`[StripeService] Triggering appointment payment notification (Provider): ${appointment.provider}`);
    try {
        await NotificationService.insertNotification({
            title: "Payment Received (Card)",
            message: `Payment received for appointment ${appointmentId}. Amount: ${appointment.totalCost}`,
            receiver: appointment.provider,
            referenceId: appointment._id,
            screen: "APPOINTMENT",
            type: "USER"
        });
    } catch (error) {
        console.error(`[StripeService] Failed to notify provider:`, error);
    }

    // Notify Customer
    console.log(`[StripeService] Triggering appointment payment notification (Customer): ${appointment.customer}`);
    try {
        await NotificationService.insertNotification({
            title: "Payment Successful",
            message: `Your payment of ${appointment.totalCost} for appointment ${appointmentId} was successful.`,
            receiver: appointment.customer,
            referenceId: appointment._id,
            screen: "APPOINTMENT",
            type: "USER"
        });
    } catch (error) {
        console.error(`[StripeService] Failed to notify customer:`, error);
    }

    await delCache([
        `cache:wallet:${appointment.customer.toString()}`,
        `cache:wallet:${appointment.provider.toString()}`
    ]);
};

const createAccountLink = async (
    stripeAccountId: string,
    returnUrl: string,
    refreshUrl: string
) => {
    const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
    });

    return accountLink.url;
};


const getAccountStatus = async (userId: string) => {
    const cacheKey = `cache:stripe:status:${userId}`;
    const cachedStatus = await getCache<any>(cacheKey);
    if (cachedStatus) {
        return cachedStatus;
    }

    const user = await User.findById(userId);
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

    if (!user.stripeAccountId) {
        const result = {
            isConnected: false,
            detailsSubmitted: false,
            requirements: [],
            stripeAccountId: null
        };
        await setCache(cacheKey, result, 180);
        return result;
    }

    try {
        const account = await stripe.accounts.retrieve(user.stripeAccountId);

        // Sync local status with Stripe status
        if (account.details_submitted && !user.isStripeConnected) {
            user.isStripeConnected = true;
            await user.save();
            await delCache(`cache:user:profile:${userId}`);
        }

        const result = {
            isConnected: user.isStripeConnected,
            detailsSubmitted: account.details_submitted,
            requirements: account.requirements?.currently_due || [],
            stripeAccountId: user.stripeAccountId,
            payoutsEnabled: account.payouts_enabled,
            chargesEnabled: account.charges_enabled
        };

        await setCache(cacheKey, result, 180); // 3 Mins TTL
        return result;
    } catch (error: any) {
        // If the account does not exist or is not connected, clear it from the user document
        if (error.raw?.type === 'invalid_request_error' || error.statusCode === 400 || error.message?.includes('not connected') || error.message?.includes('does not exist')) {
            console.log(`[StripeService] Saved stripeAccountId ${user.stripeAccountId} is invalid in getAccountStatus. Clearing...`);
            user.stripeAccountId = undefined;
            user.isStripeConnected = false;
            await user.save();
            await delCache(`cache:user:profile:${userId}`);
            
            const result = {
                isConnected: false,
                detailsSubmitted: false,
                requirements: [],
                stripeAccountId: null
            };
            await setCache(cacheKey, result, 180);
            return result;
        }
        throw error;
    }
};

export const StripeService = {
    createTopUpPaymentIntent,
    handleSuccessfulTopUpPayment,
    verifyTopUpPayment,
    createExpressAccount,
    createAccountLink,
    getAccountStatus,
    getAccount,
    handleAccountUpdate,
    createTransfer,
    createPayout,
    createAppointmentPaymentIntent,
    handleSuccessfulAppointmentPayment
};
