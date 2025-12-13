const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER ||"biccanadai@gmail.com",
        pass: process.env.SMTP_PASS || "Power081" // app password
    }
});


async function sendEmail({ to, subject, html }) {
    return transporter.sendMail({
        from: `"TESLA-AI" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html
    });
}

module.exports = { sendEmail };
