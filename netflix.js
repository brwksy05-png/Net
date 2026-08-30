'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

const NETFLIX = "https://www.netflix.com";
const GRAPHQL = `${NETFLIX}/graphql`;
const OWNER_FILE = path.join(os.homedir(), '.netflix_epr_bot_owner.json');
const TMPDIR = process.env.TMPDIR || os.tmpdir();

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
if (!BOT_TOKEN) {
    console.error("SystemExit: BOT_TOKEN missing");
    process.exit(1);
}

const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG = axios.create({ timeout: 45000 });

// إعدادات البروكسي العراقي
const PROXY_SERVER = "rp.scrapegw.com:6060";
const PROXY_USER = "et95yha52718u9-country-iq";
const PROXY_PASS = "cwf2pqqblvu5ci5";

const bot = {
    async sendMessage(chatId, text, options = {}) {
        return await tgCall("sendMessage", {
            chat_id: String(chatId),
            text,
            ...options
        });
    }
};

let CHAT_STATE = {};
let ACTIVE_JOBS = {};

// ---------------- Telegram ----------------
async function tgCall(method, data = null, timeout = 45000) {
    try {
        let r = await TG.post(`${TG_BASE}/${method}`, data || {}, { timeout });
        let obj = r.data;
        if (!obj || !obj.ok) {
            throw new Error(`Telegram API error: ${JSON.stringify(obj)}`);
        }
        return obj.result;
    } catch (exc) {
        throw exc;
    }
}

async function sendMessage(chatId, text, keyboard = false) {
    let payload = {
        chat_id: String(chatId),
        text: text,
        disable_web_page_preview: "true",
    };
    if (keyboard) {
        payload.reply_markup = JSON.stringify({
            keyboard: [[{ text: "إنشاء حساب" }]],
            resize_keyboard: true,
            is_persistent: true,
        });
    }
    try {
        await tgCall("sendMessage", payload);
    } catch (e) {}
}

async function sendPhoto(chatId, filePath, caption = "") {
    try {
        let FormData = require('form-data');
        let form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('caption', caption.substring(0, 1000));
        form.append('photo', fs.createReadStream(filePath));

        await axios.post(`${TG_BASE}/sendPhoto`, form, {
            headers: form.getHeaders(),
            timeout: 90000
        });
    } catch (exc) {}
}

async function sendDocument(chatId, filePath, caption = "") {
    try {
        let FormData = require('form-data');
        let form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('caption', caption.substring(0, 1000));
        form.append('document', fs.createReadStream(filePath));

        await axios.post(`${TG_BASE}/sendDocument`, form, {
            headers: form.getHeaders(),
            timeout: 90000
        });
    } catch (exc) {}
}

function loadOwner() {
    try {
        if (fs.existsSync(OWNER_FILE)) {
            let data = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
            return parseInt(data.owner_id);
        }
    } catch (e) {}
    return null;
}

function saveOwner(uid) {
    fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner_id: uid }), 'utf8');
    try {
        fs.chmodSync(OWNER_FILE, 0o600);
    } catch (e) {}
}

function ensureOwner(uid) {
    let owner = loadOwner();
    if (owner === null) {
        saveOwner(uid);
        return true;
    }
    return owner === uid;
}

// ---------------- Phone Normalizer ----------------
function normalizeIqPhone(text) {
    let digits = (text || "").replace(/\D+/g, "");
    if (digits.startsWith("00964")) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
    if (digits.startsWith("964") && digits.length === 12) {
        // صحيح تماماً
    } else if (digits.length === 10 && digits.startsWith("7")) {
        digits = "964" + digits;
    } else if (digits.length === 11 && digits.startsWith("964")) {
        // مقبول
    } else if (digits.length === 11 && digits.startsWith("07")) {
        digits = "964" + digits.slice(1);
    } else {
        // تنظيف افتراضي للعراق
        if (digits.length >= 10) {
            if (!digits.startsWith("964")) {
                if (digits.startsWith("0")) digits = digits.slice(1);
                digits = "964" + digits.slice(-10);
            }
        }
    }
    if (digits.length === 12 && digits.startsWith("964")) return digits;
    return null;
}

// ---------------- Puppeteer Browser Automation ----------------
async function openAndProcessWithPuppeteer(chatId, eprUrl, phone) {
    await sendMessage(chatId, "🌐 جاري تشغيل المتصفح عبر البروكسي العراقي...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            `--proxy-server=${PROXY_SERVER}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=430,900'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.authenticate({
            username: PROXY_USER,
            password: PROXY_PASS
        });

        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        
        await sendMessage(chatId, "🔗 جاري فتح رابط EPR في المتصفح...");
        await page.goto(eprUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));

        let scPath1 = path.join(TMPDIR, `step1_${Date.now()}.png`);
        await page.screenshot({ path: scPath1 });
        await sendPhoto(chatId, scPath1, "📸 صورة 1: فتح الرابط بالمتصفح");

        // الضغط على زر البدء أو المتابعة
        try {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const target = btns.find(b => /finish|start|متابعة|ابدأ|التالي|continue/i.test(b.innerText || ""));
                if (target) target.click();
            });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 3000));

        if (page.url().includes('signup') || page.url().includes('plan')) {
            await sendMessage(chatId, "📋 اختيار الخطة وتجاوز الخطوات التمهيدية...");
            try {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                    const nextBtn = btns.find(b => /next|متابعة|التالي|تأكيد/i.test(b.innerText || ""));
                    if (nextBtn) nextBtn.click();
                });
            } catch (e) {}
            await new Promise(r => setTimeout(r, 4000));
        }

        // اختيار طريقة الدفع عبر رصيد الهاتف (DCB)
        await sendMessage(chatId, "💳 اختيار طريقة الدفع عبر رصيد الهاتف (DCB)...");
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const dcbEl = elements.find(el => /dcb|mobile|رصيد|الهاتف/i.test(el.innerText || el.id || el.className));
            if (dcbEl) dcbEl.click();
        });

        await new Promise(r => setTimeout(r, 3000));

        let scPath2 = path.join(TMPDIR, `step2_${Date.now()}.png`);
        await page.screenshot({ path: scPath2 });
        await sendPhoto(chatId, scPath2, "📸 صورة 2: صفحة إدخال رقم الهاتف");

        // حقن رقم الهاتف العراقي بالشكل الصحيح 9647xxxxxxxx
        await sendMessage(chatId, `📱 حقن الرقم العراقي بدقة: ${phone}`);
        await page.waitForSelector('input[type="tel"], input[name*="phone"], input[id*="phone"]', { timeout: 10000 }).catch(() => {});
        
        const phoneEntered = await page.evaluate((phoneNumber) => {
            const input = document.querySelector('input[type="tel"], input[name*="phone"], input[id*="phone"], input');
            if (input) {
                input.focus();
                input.value = "";
                input.value = phoneNumber;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, phone);

        if (!phoneEntered) {
            throw new Error("تعذر العثور على حقل إدخال رقم الهاتف في المتصفح.");
        }

        await new Promise(r => setTimeout(r, 1500));

        let scPath3 = path.join(TMPDIR, `step3_${Date.now()}.png`);
        await page.screenshot({ path: scPath3 });
        await sendPhoto(chatId, scPath3, "📸 صورة 3: بعد حقن الرقم بدقة 964");

        // الضغط على زر التحقق
        await sendMessage(chatId, "🚀 الضغط على زر التحقق (Verify)...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const verifyBtn = btns.find(b => /verify|send|متابعة|إرسال|تحقق/i.test(b.innerText || ""));
            if (verifyBtn) verifyBtn.click();
        });

        await new Promise(r => setTimeout(r, 5000));

        let scPath4 = path.join(TMPDIR, `step4_${Date.now()}.png`);
        await page.screenshot({ path: scPath4 });
        await sendPhoto(chatId, scPath4, "📸 صورة 4: مرحلة إرسال الكود النهائية");

        await sendMessage(chatId, "✅ تم إرسال طلب الـ SMS بنجاح عبر متصفح البروكسي العراقي!\n\n🔐 يرجى إدخال رمز التحقق (OTP) يدوياً في صفحة نتفلكس لإتمام العملية.");

    } catch (err) {
        await sendMessage(chatId, `❌ خطأ في المتصفح الآلي:\n${err.message}`);
    } finally {
        await browser.close();
    }
}

// ---------------- Flow Management ----------------
async function waitForPhone(chatId, timeout = 300000) {
    return new Promise((resolve) => {
        CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
        CHAT_STATE[chatId].awaiting_phone = true;
        CHAT_STATE[chatId].phone_value = null;

        const startTime = Date.now();
        const interval = setInterval(() => {
            let st = CHAT_STATE[chatId];
            if (!st) {
                clearInterval(interval);
                resolve(null);
                return;
            }
            if (st.phone_value) {
                st.awaiting_phone = false;
                let val = st.phone_value;
                st.phone_value = null;
                clearInterval(interval);
                resolve(val);
                return;
            }
            if (Date.now() - startTime > timeout) {
                st.awaiting_phone = false;
                clearInterval(interval);
                resolve(null);
            }
        }, 500);
    });
}

async function fastFlow(chatId, eprUrl) {
    let tAll = Date.now();
    await sendMessage(
        chatId,
        "⚡ بدأ البوت.\n" +
        "أطلب منك الآن رقم الهاتف العراقي لتنفيذ الخطوات وفتح المتصفح عبر البروكسي العراقي.\n" +
        "رمز OTP المرتبط بالفوترة يبقى إدخاله يدويًا داخل Netflix."
    );

    CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
    CHAT_STATE[chatId].awaiting_phone = true;
    await sendMessage(chatId, "📱 أرسل رقم هاتفك العراقي الآن (بأي صيغة مثل 07xxxxxxxxx أو 7xxxxxxxxx أو 9647xxxxxxxxx):");

    let phone = await waitForPhone(chatId);
    if (!phone) {
        throw new Error("انتهى وقت انتظار رقم الهاتف");
    }

    await sendMessage(chatId, `✅ تم استلام الرقم وتنسيقه: ${phone}\nجاري فتح المتصفح عبر البروكسي العراقي وتنفيذ الخطوات التقنية...`);
    await openAndProcessWithPuppeteer(chatId, eprUrl, phone);

    let total = (Date.now() - tAll) / 1000;
    await sendMessage(
        chatId,
        "📩 تمت العملية عبر متصفح البروكسي العراقي بنجاح.\n" +
        `⏱ الزمن الكلي: ${total.toFixed(1)} ثانية\n\n` +
        "🔐 رمز OTP هنا يعتبر موافقة دفع/فوترة، دخله يدويًا داخل Netflix.",
        true
    );
}

async function runJob(chatId, eprUrl) {
    try {
        await fastFlow(chatId, eprUrl);
    } catch (exc) {
        let errPath = path.join(TMPDIR, `netflix_fast_v17_error_${Date.now()}.txt`);
        fs.writeFileSync(errPath, `${exc.name}: ${exc.message}\n${exc.stack || ''}\n`, 'utf8');
        await sendMessage(chatId, `❌ توقف:\n${exc.name}: ${exc.message}`);
        await sendDocument(chatId, errPath, "تشخيص الخطأ المختصر");
    } finally {
        CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
        CHAT_STATE[chatId].awaiting_epr = false;
        CHAT_STATE[chatId].awaiting_phone = false;
        CHAT_STATE[chatId].phone_value = null;
        delete ACTIVE_JOBS[chatId];
    }
}

function startJob(chatId, eprUrl) {
    if (ACTIVE_JOBS[chatId]) {
        sendMessage(chatId, "عندك عملية شغالة حالياً.");
        return;
    }
    ACTIVE_JOBS[chatId] = true;
    runJob(chatId, eprUrl);
}

// ---------------- Telegram Bot Listeners ----------------
async function pollForever() {
    console.log("\nNetflix EPR Automation Bot (Node.js) is running...")
    let offset = 0;
    while (true) {
        try {
            let updates = await tgCall("getUpdates", {
                offset: String(offset),
                timeout: "30",
                allowed_updates: JSON.stringify(["message"]),
            }, 40000);

            for (let upd of updates || []) {
                offset = Math.max(offset, parseInt(upd.update_id || 0) + 1);
                if (upd.message) {
                    await handleMessage(upd.message);
                }
            }
        } catch (exc) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function handleMessage(msg) {
    let chatId = msg.chat?.id;
    let userId = msg.from?.id;
    let text = String(msg.text || "").trim();

    if (!chatId || !userId) return;
    if (!ensureOwner(userId)) {
        await sendMessage(chatId, "⛔ هذا البوت خاص بصاحبه فقط.");
        return;
    }

    if (text === "/start") {
        await sendMessage(chatId, "✅ البوت الآلي جاهز. اضغط «إنشاء حساب».", true);
        return;
    }

    if (["إنشاء حساب", "/new", "/create"].includes(text)) {
        if (ACTIVE_JOBS[chatId]) {
            await sendMessage(chatId, "عندك عملية شغالة حالياً.");
            return;
        }
        CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
        CHAT_STATE[chatId].awaiting_epr = true;
        CHAT_STATE[chatId].awaiting_phone = false;
        CHAT_STATE[chatId].phone_value = null;
        await sendMessage(chatId, "🔗 دز رابط Netflix EPR فقط:");
        return;
    }

    let st = CHAT_STATE[chatId] || {};
    if (st.awaiting_phone) {
        let phone = normalizeIqPhone(text);
        if (!phone) {
            await sendMessage(chatId, "📱 الرقم مو بصيغة عراقية واضحة. يرجى إدخال رقم صحيح (مثال: 7710104462 أو 07710104462)");
            return;
        }
        st.phone_value = phone;
        st.awaiting_phone = false;
        return;
    }

    if (st.awaiting_epr) {
        if (!text.startsWith("https://www.netflix.com/epr?")) {
            await sendMessage(chatId, "الرابط مو EPR واضح. دز رابط يبدأ بـ https://www.netflix.com/epr?");
            return;
        }
        st.awaiting_epr = false;
        startJob(chatId, text);
        return;
    }

    await sendMessage(chatId, "اضغط «إنشاء حساب» حتى تبدأ. وإذا وصلت OTP مال الفوترة، دخله يدويًا داخل Netflix وليس بالبوت.", true);
}

// بدء التشغيل
pollForever();
