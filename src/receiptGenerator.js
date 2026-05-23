import htmlPdf from "html-pdf-node";

/**
 * Generates an elegant, modern business invoice layout using standard HTML/CSS templates.
 * @param {Object} payment - Structural transaction fields.
 * @returns {Promise<Buffer>} - Resolves directly with an in-memory PDF buffer file.
 */
export function generateReceiptPdfBuffer(payment) {
  return new Promise((resolve, reject) => {
    const formattedAmount = Number(payment.amount).toFixed(2);

    // Clean HTML Structure with professional invoice invoice canvas elements
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a202c; margin: 30px; line-height: 1.4; }
        .receipt-container { max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; }
        .header-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .academy-title { font-size: 20px; font-weight: bold; color: #1a202c; text-transform: uppercase; letter-spacing: 0.5px; }
        .academy-tagline { font-size: 10px; font-style: italic; color: #718096; margin-top: 4px; }
        .meta-text { text-align: right; font-size: 11px; color: #4a5568; }
        .receipt-id { font-size: 13px; font-weight: bold; color: #2d3748; margin-bottom: 4px; }
        .divider { border-top: 1px solid #e2e8f0; margin: 20px 0; }
        .customer-section { margin-bottom: 30px; font-size: 12px; }
        .customer-title { font-weight: bold; font-size: 13px; color: #1a202c; margin-bottom: 8px; }
        .item-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
        .item-table th { background-color: #2d3748; color: #ffffff; text-align: left; padding: 10px; font-size: 11px; font-weight: bold; }
        .item-table td { padding: 14px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; background-color: #f7fafc; }
        .verification-box { background-color: #ffffff; border: 1px dashed #cbd5e0; padding: 15px; border-radius: 6px; font-size: 11px; margin-bottom: 50px; }
        .verification-title { font-weight: bold; color: #2d3748; margin-bottom: 6px; text-transform: uppercase; }
        .footer { text-align: center; font-size: 10px; color: #718096; border-top: 0.5px solid #cbd5e0; padding-top: 15px; }
        .thanks { font-weight: bold; color: #4a5568; margin-top: 6px; font-size: 11px; }
      </style>
    </head>
    <body>
      <div class="receipt-container">
        <table class="header-table">
          <tr>
            <td>
              <div class="academy-title">Airborne Gymnastics Center</div>
              <div class="academy-tagline">Building Elite Athletic Foundations & Core Character</div>
            </td>
            <td class="meta-text">
              <div class="receipt-id">RECEIPT NO: ${payment.receipt_number}</div>
              <div><b>Date:</b> ${new Date().toLocaleDateString()}</div>
              <div><b>Time:</b> ${new Date().toLocaleTimeString()}</div>
            </td>
          </tr>
        </table>

        <div class="divider"></div>

        <div class="customer-section">
          <div class="customer-title">RECEIPT TO:</div>
          <div><b>Student Name:</b> ${payment.student_name || "Unassigned Profile Match"}</div>
        </div>

        <table class="item-table">
          <thead>
            <tr>
              <th>DESCRIPTION</th>
              <th style="text-align: right; width: 120px;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Gymnastics Academy Training Fees</td>
              <td style="text-align: right; font-weight: bold;">${payment.currency || "RM"} ${formattedAmount}</td>
            </tr>
          </tbody>
        </table>

        <div class="verification-box">
          <div class="verification-title">Transaction Verification Audit Data</div>
          <div><b>Bank / Platform Reference:</b> ${payment.bank_or_platform || "Direct Gateway Upload"}</div>
          <div style="margin-top: 3px;"><b>Reference Assignment ID:</b> ${payment.reference_number || "N/A"}</div>
        </div>

        <div class="footer">
          <div>This is an automatically generated electronic receipt. No signature is required.</div>
          <div class="thanks">Thank you for training with Airborne Gymnastics Center! 🙏</div>
        </div>
      </div>
    </body>
    </html>
    `;

    // Process options configuring the page compilation boundaries
    const options = {
      format: "A4",
      margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" },
    };
    const file = { content: htmlContent };

    htmlPdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        resolve(pdfBuffer);
      })
      .catch((err) => {
        reject(err);
      });
  });
}
