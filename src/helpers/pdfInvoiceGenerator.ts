import PDFDocument from 'pdfkit';
import { Response } from 'express';
import https from 'node:https';

let cachedLogoBuffer: Buffer | null = null;

// Helper to fetch and cache logo buffer
const fetchLogoBuffer = (): Promise<Buffer | null> => {
    if (cachedLogoBuffer) return Promise.resolve(cachedLogoBuffer);
    const logoUrl = "https://texme-media-bucket.s3.us-east-1.amazonaws.com/serviceimage/1770608892815-1770608892522-7m6bfj.png";

    return new Promise((resolve) => {
        https.get(logoUrl, (res) => {
            if (res.statusCode !== 200) return resolve(null);
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                cachedLogoBuffer = Buffer.concat(chunks);
                resolve(cachedLogoBuffer);
            });
        }).on('error', () => resolve(null));
    });
};

export interface IInvoicePDFPayload {
    title?: string;
    invoiceNumber: string;
    date: Date | string;
    amount: number;
    fee?: number;
    netAmount?: number;
    billedFrom?: {
        name?: string;
        email?: string;
        role?: string;
    };
    billedTo?: {
        name?: string;
        email?: string;
        phone?: string;
        address?: string;
    };
    details: Record<string, any>;
}

export const buildProfessionalInvoicePDF = async (payload: IInvoicePDFPayload, res?: Response): Promise<InstanceType<typeof PDFDocument>> => {
    const logoBuffer = await fetchLogoBuffer();

    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: `Invoice #${payload.invoiceNumber}`,
            Author: 'Txme Technologies',
        }
    });

    if (res) {
        const filename = `invoice-${payload.invoiceNumber}.pdf`;
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);
    }

    // Pure Black & White Color Palette
    const blackTextColor = '#000000';
    const darkGrayTextColor = '#333333';
    const lightGrayTextColor = '#555555';
    const tableHeaderBg = '#111111';
    const cardBgColor = '#F9F9F9';
    const borderColor = '#D1D5DB';

    const pageWidth = 595.28;
    const pageMargin = 40;
    const contentWidth = pageWidth - (pageMargin * 2); // 515.28 pt

    // 1. Top Black Accent Line
    doc.rect(0, 0, pageWidth, 4).fill(blackTextColor);

    // 2. Logo & Header Section
    const headerY = 28;
    if (logoBuffer) {
        try {
            doc.image(logoBuffer, pageMargin, headerY, { height: 40 });
        } catch (e) {
            doc.fillColor(blackTextColor).fontSize(24).text('Txme', pageMargin, headerY + 4);
        }
    } else {
        doc.fillColor(blackTextColor).fontSize(24).text('Txme', pageMargin, headerY + 4);
    }

    // Invoice / Record Meta (Top Right)
    const documentTitle = (payload.title || 'INVOICE').toUpperCase();
    const isInvoice = documentTitle === 'INVOICE';
    const numberLabel = isInvoice ? 'INVOICE NO:' : 'REF NO:';
    const titleFontSize = documentTitle.length > 20 ? 14 : (documentTitle.length > 12 ? 16 : 20);

    const formattedInvoiceNo = payload.invoiceNumber.toString().slice(-8).toUpperCase();
    const formattedDate = new Date(payload.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    doc.fillColor(blackTextColor).fontSize(titleFontSize).text(documentTitle, pageMargin, headerY, { align: 'right', width: contentWidth });
    doc.fillColor(lightGrayTextColor).fontSize(9)
        .text(`${numberLabel} #${formattedInvoiceNo}`, pageMargin, headerY + 25, { align: 'right', width: contentWidth })
        .text(`DATE OF ISSUE: ${formattedDate}`, pageMargin, headerY + 37, { align: 'right', width: contentWidth });

    // Header Divider Line
    const dividerY = headerY + 54;
    doc.moveTo(pageMargin, dividerY).lineTo(pageWidth - pageMargin, dividerY).strokeColor(borderColor).lineWidth(1).stroke();

    // 3. Issued By & Issued To Grid (Side-by-side)
    const cardY = dividerY + 12;
    const cardWidth = (contentWidth - 14) / 2; // 250.64 pt
    const cardHeight = 74;

    // Left Card (ISSUED BY)
    doc.roundedRect(pageMargin, cardY, cardWidth, cardHeight, 4).fillAndStroke(cardBgColor, borderColor);
    doc.fillColor(blackTextColor).fontSize(8).text('ISSUED BY', pageMargin + 12, cardY + 10);
    doc.fillColor(blackTextColor).fontSize(10).text(payload.billedFrom?.name || 'Txme Platform Services', pageMargin + 12, cardY + 21);
    doc.fillColor(darkGrayTextColor).fontSize(8.5)
        .text(`Email: ${payload.billedFrom?.email || 'Developer@Txme.nl'}`, pageMargin + 12, cardY + 34)
        .text(`Role: ${payload.billedFrom?.role || 'Service Platform'}`, pageMargin + 12, cardY + 46)
        .text('Web: https://txme.nl', pageMargin + 12, cardY + 58);

    // Right Card (ISSUED TO)
    const rightCardX = pageMargin + cardWidth + 14;
    doc.roundedRect(rightCardX, cardY, cardWidth, cardHeight, 4).fillAndStroke(cardBgColor, borderColor);
    doc.fillColor(blackTextColor).fontSize(8).text('ISSUED TO', rightCardX + 12, cardY + 10);
    doc.fillColor(blackTextColor).fontSize(10).text(payload.billedTo?.name || 'Valued Customer', rightCardX + 12, cardY + 21);
    doc.fillColor(darkGrayTextColor).fontSize(8.5)
        .text(`Email: ${payload.billedTo?.email || 'N/A'}`, rightCardX + 12, cardY + 34)
        .text(`Phone: ${payload.billedTo?.phone || 'N/A'}`, rightCardX + 12, cardY + 46)
        .text(`Address: ${payload.billedTo?.address || 'Provided in App'}`, rightCardX + 12, cardY + 58);

    // 4. Structured Itemized Table
    let tableY = cardY + cardHeight + 18;
    const tableHeaderHeight = 22;

    // Table Header Bar (Black Background)
    doc.roundedRect(pageMargin, tableY, contentWidth, tableHeaderHeight, 3).fill(tableHeaderBg);
    doc.fillColor('#FFFFFF').fontSize(8.5)
        .text('DESCRIPTION / ATTRIBUTE', pageMargin + 12, tableY + 6)
        .text('VALUE / DETAILS', pageMargin + 200, tableY + 6, { width: contentWidth - 212, align: 'right' });

    tableY += tableHeaderHeight;

    // Table Rows
    const detailEntries = Object.entries(payload.details);
    const rowHeight = 20;

    detailEntries.forEach(([key, val], index) => {
        const rowBg = index % 2 === 0 ? '#FFFFFF' : cardBgColor;
        doc.rect(pageMargin, tableY, contentWidth, rowHeight).fillAndStroke(rowBg, borderColor);

        doc.fillColor(blackTextColor).fontSize(8.5)
            .text(key, pageMargin + 12, tableY + 5)
            .fillColor(darkGrayTextColor)
            .text(String(val), pageMargin + 200, tableY + 5, { width: contentWidth - 212, align: 'right' });

        tableY += rowHeight;
    });

    // 5. Total Financial Summary Box (Right-aligned)
    tableY += 14;
    const totalBoxWidth = 200;
    const totalBoxX = pageWidth - pageMargin - totalBoxWidth;
    const totalBoxHeight = 48;

    doc.roundedRect(totalBoxX, tableY, totalBoxWidth, totalBoxHeight, 4).fillAndStroke(cardBgColor, blackTextColor);

    if (payload.fee !== undefined && payload.fee > 0 && payload.netAmount !== undefined) {
        doc.fillColor(darkGrayTextColor).fontSize(8.5).text('PAYMENT AMOUNT:', totalBoxX + 12, tableY + 8);
        doc.fillColor(blackTextColor).fontSize(8.5).text(`€${Number(payload.amount).toFixed(2)}`, totalBoxX + 90, tableY + 8, { width: 98, align: 'right' });

        doc.fillColor(darkGrayTextColor).fontSize(8.5).text('FEES (STRIPE):', totalBoxX + 12, tableY + 19);
        doc.fillColor('#DC2626').fontSize(8.5).text(`- €${Number(payload.fee).toFixed(2)}`, totalBoxX + 90, tableY + 19, { width: 98, align: 'right' });

        // Inner Line inside Total Box
        doc.moveTo(totalBoxX + 12, tableY + 30).lineTo(totalBoxX + totalBoxWidth - 12, tableY + 30).strokeColor(blackTextColor).lineWidth(0.5).stroke();

        doc.fillColor(blackTextColor).fontSize(9.5).text('NET CREDITED:', totalBoxX + 12, tableY + 33);
        doc.fillColor(blackTextColor).fontSize(10.5).text(`€${Number(payload.netAmount).toFixed(2)}`, totalBoxX + 90, tableY + 32, { width: 98, align: 'right' });
    } else {
        doc.fillColor(darkGrayTextColor).fontSize(8.5).text('SUBTOTAL:', totalBoxX + 12, tableY + 8);
        doc.fillColor(blackTextColor).fontSize(8.5).text(`€${Number(payload.amount).toFixed(2)}`, totalBoxX + 90, tableY + 8, { width: 98, align: 'right' });

        doc.fillColor(darkGrayTextColor).fontSize(8.5).text('TAX / FEES:', totalBoxX + 12, tableY + 19);
        doc.fillColor(blackTextColor).fontSize(8.5).text('€0.00', totalBoxX + 90, tableY + 19, { width: 98, align: 'right' });

        // Inner Line inside Total Box
        doc.moveTo(totalBoxX + 12, tableY + 30).lineTo(totalBoxX + totalBoxWidth - 12, tableY + 30).strokeColor(blackTextColor).lineWidth(0.5).stroke();

        doc.fillColor(blackTextColor).fontSize(9.5).text('TOTAL AMOUNT:', totalBoxX + 12, tableY + 33);
        doc.fillColor(blackTextColor).fontSize(10.5).text(`€${Number(payload.amount).toFixed(2)}`, totalBoxX + 90, tableY + 32, { width: 98, align: 'right' });
    }

    // 6. Professional Short Footer (Strict Single Page Fit)
    const footerY = 775;
    doc.moveTo(pageMargin, footerY - 10).lineTo(pageWidth - pageMargin, footerY - 10).strokeColor(borderColor).lineWidth(1).stroke();

    doc.fillColor(lightGrayTextColor).fontSize(8)
        .text('Thank you for choosing Txme! Support: Developer@Txme.nl | System-generated receipt.', pageMargin, footerY, { align: 'center', width: contentWidth });

    doc.end();
    return doc;
};
