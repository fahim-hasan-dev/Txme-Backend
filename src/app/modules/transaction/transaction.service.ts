import { JwtPayload } from "jsonwebtoken";
import QueryBuilder from "../../../helpers/QueryBuilder";
import { WalletTransaction } from "./transaction.model";
import { Wallet } from "../wallet/wallet.model";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import { buildProfessionalInvoicePDF } from "../../../helpers/pdfInvoiceGenerator";
import { WalletService } from "../wallet/wallet.service";

const generateInvoicePDF = async (reference: string) => {
    const transaction = await getTransactionByReference(reference);
    if (!transaction) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Transaction not found");
    }

    const details: Record<string, any> = {
        'Transaction ID': transaction._id.toString(),
        'Transaction Type': transaction.type.toUpperCase(),
    };

    if (transaction.reference) {
        details['Reference / TxID'] = transaction.reference;
    }

    let documentTitle = 'Wallet Transaction Record';
    if (transaction.type === 'topup') {
        documentTitle = 'Record of Wallet Top Up';
    } else if (transaction.type === 'withdraw') {
        documentTitle = 'Record of Wallet Withdraw';
    } else if (transaction.type === 'send') {
        documentTitle = 'Record of Wallet Send Money';
    } else if (transaction.type === 'promotion') {
        documentTitle = 'Record of Wallet Promotion';
    } else if (transaction.type === 'payment') {
        documentTitle = 'Record of Wallet Payment';
    }

    const doc = await buildProfessionalInvoicePDF({
        title: documentTitle,
        invoiceNumber: transaction._id.toString(),
        // @ts-ignore
        date: transaction.createdAt,
        amount: transaction.amount,
        billedFrom: {
            name: (transaction.from as any)?.fullName || 'Txme System Platform',
            email: (transaction.from as any)?.email || 'system@txme.nl',
            role: (transaction.from as any)?.role || 'SYSTEM'
        },
        billedTo: {
            name: (transaction.to as any)?.fullName || 'Valued User',
            email: (transaction.to as any)?.email || 'N/A',
            phone: (transaction.to as any)?.phone || 'N/A'
        },
        details
    });

    return doc;
};

const getAllTransactionsFromDB = async (query: Record<string, any>) => {
    const transactionQuery = new QueryBuilder(
        WalletTransaction.find()
            .populate("wallet", "balance")
            .populate("from", "fullName profilePicture email")
            .populate("to", "fullName profilePicture email")
            .populate("appointment", "service status price date startTime endTime totalCost totalWorkedTime"),
        query
    )
        .filter()
        .sort()
        .paginate()
        .fields();

    const result = await transactionQuery.modelQuery.lean();
    const meta = await transactionQuery.getPaginationInfo();

    return { result, meta };
};

const getMyTransactionsFromDB = async (user: JwtPayload, query: Record<string, any>) => {
    const { id } = user;

    // Find or create user's wallet
    const wallet = await WalletService.getOrCreateWallet(id);

    // Filter by user's wallet ID
    query.wallet = wallet._id.toString();

    const transactionQuery = new QueryBuilder(
        WalletTransaction.find()
            .populate("wallet", "balance")
            .populate("from", "fullName profilePicture email")
            .populate("to", "fullName profilePicture email")
            .populate("appointment", "service status price date startTime endTime totalCost totalWorkedTime"),
        query
    )
        .filter()
        .sort()
        .paginate()
        .fields();

    const result = await transactionQuery.modelQuery.lean();
    const meta = await transactionQuery.getPaginationInfo();

    return { result, meta };
};

const getTransactionByReference = async (referenceId: string) => {
    const result = await WalletTransaction.findOne({ reference: referenceId })
        .populate("wallet", "balance")
        .populate("from", "fullName profilePicture email")
        .populate("to", "fullName profilePicture email")
        .populate("appointment", "service status price date startTime endTime totalCost totalWorkedTime")
        .lean();

    if (!result) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Transaction not found");
    }

    return result;
};

export const TransactionService = {
    getAllTransactionsFromDB,
    getMyTransactionsFromDB,
    getTransactionByReference,
    generateInvoicePDF
};
