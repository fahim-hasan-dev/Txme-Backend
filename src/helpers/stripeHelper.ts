import stripe from "../config/stripe";

export const getOrCreateStripeCustomer = async (email: string): Promise<string> => {
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
        return existing.data[0].id;
    }
    const customer = await stripe.customers.create({ email });
    return customer.id;
};
