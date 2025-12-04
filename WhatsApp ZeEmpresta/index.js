import whatsappPkg from 'whatsapp-web.js';
import axios from 'axios';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import path from 'path';
import gttsPkg from 'gtts';
import cors from 'cors';

const PORT = 3000;
const { Client, LocalAuth, MessageMedia } = whatsappPkg;
const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://191.252.156.197' }));

let config = {
    webhookUrl: 'http://localhost:5678/webhook/zeempresta_whatsapp',
    whatsappReady: false
};

let activeUsers = [];

const formatPhoneNumber = (phone) => {
    return phone.startsWith('+') ? phone.replace('@c.us', '') : `+${phone.replace('@c.us', '')}`;
};

const formatPhoneForWhatsApp = (phone) => `${phone.replace('+', '')}@c.us`;

const sendMessageToWebhook = async (message, senderPhone, receiverPhone, messageType = 'text', mediaBase64 = null, isFromUser = true) => {
    try {
        return await axios.post(config.webhookUrl, {
            senderPhone: formatPhoneNumber(senderPhone),
            receiverPhone: formatPhoneNumber(receiverPhone),
            messageType,
            mediaBase64,
            message,
            isFromUser
        });
    } catch (error) {
        console.error('Erro ao enviar para o Webhook do n8n:', error.message);
        return null;
    }
};

const sendMessageToWhatsapp = async (phone, message) => {
    try {
        const formattedPhone = formatPhoneForWhatsApp(phone);
        const chat = await client.getChatById(formattedPhone);
        if (chat) await chat.sendMessage(message);
    } catch (error) {
        console.error('Erro ao enviar mensagem via WhatsApp:', error.message);
    }
};

const sendAudioToWhatsapp = async (phone, message) => {
    try {
        const formattedPhone = formatPhoneForWhatsApp(phone);
        const audioDir = path.join(process.cwd(), 'audios');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const audioFileName = `audio_${timestamp}.mp3`;
        const audioPath = path.join(audioDir, audioFileName);

        const gtts = new gttsPkg(message, 'pt');
        gtts.save(audioPath, async (err) => {
            if (err) return console.error('Erro ao gerar áudio:', err);

            const chat = await client.getChatById(formattedPhone);
            if (chat) {
                const audioBuffer = fs.readFileSync(audioPath);
                const media = new MessageMedia('audio/mp3', audioBuffer.toString('base64'), audioFileName);
                await client.sendMessage(formattedPhone, media, { sendAudioAsVoice: true });
                fs.unlink(audioPath, () => { });
            }
        });
    } catch (error) {
        console.error('Erro ao enviar áudio via WhatsApp:', error.message);
    }
};

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => {
    config.whatsappReady = true;
    console.log('WhatsApp está pronto!');
});
client.on('auth_failure', (msg) => console.error('Falha de autenticação:', msg));
client.on('disconnected', (reason) => {
    config.whatsappReady = false;
    console.log('Desconectado:', reason);
});

client.on('message', async (message) => {
    const senderPhone = message.from;
    const receiverPhone = message.to;
    let messageType = 'text';
    let mediaBase64 = null;

    if (message.hasMedia) {
        const media = await message.downloadMedia();
        if (media.mimetype.startsWith('audio/')) {
            messageType = 'audio';
            mediaBase64 = media.data;
        }
    }

    await sendMessageToWebhook(message.body, senderPhone, receiverPhone, messageType, mediaBase64, true);
});

client.on('message_create', async (msg) => {
    if (msg.fromMe) {
        const senderPhone = msg.from;
        const receiverPhone = msg.to;
        let messageType = 'text';
        let mediaBase64 = null;

        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if (media.mimetype.startsWith('audio/')) {
                messageType = 'audio';
                mediaBase64 = media.data;
            }
        }

        await sendMessageToWebhook(msg.body, senderPhone, receiverPhone, messageType, mediaBase64, false);
    }
});

app.get('/get-webhook', (req, res) => {
    res.json({ webhookUrl: config.webhookUrl, whatsappReady: config.whatsappReady });
});

app.get('/status-whatsapp', (req, res) => {
    res.json({ whatsappReady: config.whatsappReady });
});

app.post('/set-webhook', (req, res) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'Parâmetro "webhookUrl" é obrigatório.' });
    config.webhookUrl = webhookUrl;
    res.json({ message: 'Webhook atualizado com sucesso!', webhookUrl });
});

app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Parâmetros "phone" e "message" são obrigatórios' });
    await sendMessageToWhatsapp(phone, message);
    res.json({ message: 'Mensagem enviada com sucesso!' });
});

app.post('/send-audio', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Parâmetros "phone" e "message" são obrigatórios' });
    await sendAudioToWhatsapp(phone, message);
    res.json({ message: 'Áudio enviado com sucesso!' });
});

app.listen(PORT, () => console.log(`Servidor Express rodando na porta ${PORT}`));
client.initialize();
