import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StripeService } from "./stripe.service";
import { StatusCodes } from "http-status-codes";
import config from "../../../config";

const createTopUpPaymentIntent = catchAsync(async (req, res) => {
    const { amount } = req.body;
    const result = await StripeService.createTopUpPaymentIntent(
        req.user.id,
        amount,
        req.user.email
    );
    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: "Payment intent created successfully",
        data: result,
    });
});

const verifyTopUpPayment = catchAsync(async (req, res) => {
    const { paymentIntentId } = req.body;
    const result = await StripeService.verifyTopUpPayment(paymentIntentId);
    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: "Payment verified successfully",
        data: result,
    });
});

const createAppointmentPaymentIntent = catchAsync(async (req, res) => {
    const { appointmentId } = req.params;
    const result = await StripeService.createAppointmentPaymentIntent(
        appointmentId,
        req.user.email
    );
    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: "Appointment payment intent created successfully",
        data: result,
    });
});

const createAccountLink = catchAsync(async (req, res) => {
    let { return_url, refresh_url } = req.body;

    const baseUrl = "https://api.txme-exchange.com/api/v1/stripe";

    if (!return_url || return_url.startsWith('http://')) {
        return_url = `${baseUrl}/return`;
    }

    if (!refresh_url || refresh_url.startsWith('http://')) {
        refresh_url = `${baseUrl}/refresh`;
    }

    const stripeAccountId = await StripeService.createExpressAccount(
        req.user.id,
        req.user.email
    );

    const url = await StripeService.createAccountLink(
        stripeAccountId,
        return_url,
        refresh_url
    );

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: "Account link created successfully",
        data: { url, stripeAccountId },
    });
});

const getAccountStatus = catchAsync(async (req, res) => {
    const result = await StripeService.getAccountStatus(req.user.id);
    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: "Account status retrieved successfully",
        data: result,
    });
});

// Export moved to bottom


const handleConnectReturn = catchAsync(async (req: Request, res: Response) => {
    const mobileAppUrl = "txme://app/stripe-onboarding?result=success";
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Connected - Txme</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: #333;
            }
            .card {
                background: white;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                text-align: center;
                max-width: 400px;
                width: 90%;
            }
            .icon {
                font-size: 60px;
                color: #4CAF50;
                margin-bottom: 20px;
            }
            h1 {
                margin: 0 0 10px;
                font-size: 24px;
                color: #2D3748;
            }
            p {
                margin: 0 0 30px;
                color: #718096;
                line-height: 1.5;
            }
            .btn {
                display: inline-block;
                padding: 15px 30px;
                background-color: #4A90E2;
                color: white;
                text-decoration: none;
                border-radius: 12px;
                font-weight: bold;
                transition: transform 0.2s, background-color 0.2s;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .btn:active {
                transform: scale(0.98);
                background-color: #357ABD;
            }
            .loader {
                margin-top: 20px;
                font-size: 14px;
                color: #A0AEC0;
            }
        </style>
        <script>
            function performRedirect() {
                try {
                    window.location.href = "${mobileAppUrl}";
                    if (window.top && window.top !== window) {
                        window.top.location.href = "${mobileAppUrl}";
                    }
                    var link = document.createElement('a');
                    link.href = "${mobileAppUrl}";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } catch (e) {}
            }
            performRedirect();
            window.addEventListener('load', function() {
                setTimeout(performRedirect, 200);
            });
            setTimeout(performRedirect, 2000);
        </script>
    </head>
    <body onclick="performRedirect()">
        <div class="card">
            <div class="icon">✅</div>
            <h1>Account Connected!</h1>
            <p>Your Stripe account is successfully connected. We are taking you back to the Txme app.</p>
            <a href="${mobileAppUrl}" class="btn">Return to App</a>
            <div class="loader">If the app doesn't open automatically, <br><strong>tap anywhere</strong> or click the button.</div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

const handleConnectRefresh = catchAsync(async (req: Request, res: Response) => {
    const mobileAppUrl = "txme://app/stripe-onboarding?result=failed";
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connection Incomplete - Txme</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
                color: #333;
            }
            .card {
                background: white;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                text-align: center;
                max-width: 400px;
                width: 90%;
            }
            .icon {
                font-size: 60px;
                color: #FFA000;
                margin-bottom: 20px;
            }
            h1 {
                margin: 0 0 10px;
                font-size: 24px;
                color: #2D3748;
            }
            p {
                margin: 0 0 30px;
                color: #718096;
                line-height: 1.5;
            }
            .btn {
                display: inline-block;
                padding: 15px 30px;
                background-color: #4A90E2;
                color: white;
                text-decoration: none;
                border-radius: 12px;
                font-weight: bold;
                transition: transform 0.2s, background-color 0.2s;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .btn:active {
                transform: scale(0.98);
                background-color: #357ABD;
            }
            .loader {
                margin-top: 20px;
                font-size: 14px;
                color: #A0AEC0;
            }
        </style>
        <script>
            function performRedirect() {
                try {
                    window.location.href = "${mobileAppUrl}";
                    if (window.top && window.top !== window) {
                        window.top.location.href = "${mobileAppUrl}";
                    }
                    var link = document.createElement('a');
                    link.href = "${mobileAppUrl}";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } catch (e) {}
            }
            performRedirect();
            window.addEventListener('load', function() {
                setTimeout(performRedirect, 200);
            });
            setTimeout(performRedirect, 2000);
        </script>
    </head>
    <body onclick="performRedirect()">
        <div class="card">
            <div class="icon">⚠️</div>
            <h1>Connection Incomplete</h1>
            <p>Your Stripe connection was not finished. Please return to the app to try again.</p>
            <a href="${mobileAppUrl}" class="btn">Return to App</a>
            <div class="loader">If the app doesn't open automatically, <br><strong>tap anywhere</strong> or click the button.</div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

export const StripeController = {
    createAccountLink,
    getAccountStatus,
    createTopUpPaymentIntent,
    verifyTopUpPayment,
    createAppointmentPaymentIntent,
    handleConnectReturn,
    handleConnectRefresh
};
