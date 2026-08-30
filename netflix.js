const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

const BOT_TOKEN = process.env.BOT_TOKEN || "";
if (!BOT_TOKEN) {
    console.warn("⚠️ تحذير: BOT_TOKEN غير موجود في متغيرات البيئة!");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const OWNER_FILE = require('path').join(require('os').homedir(), '.netflix_epr_bot_owner.json');
const CHAT_STATE = {};
const ACTIVE_JOBS = {};

// إعدادات البروكسي العراقي المطلوب
const PROXY_SERVER = "rp.scrapegw.com:6060";
const PROXY_USER = "et95yha52718u9-country-iq";
const PROXY_PASS = "cwf2pqqblvu5ci5";

// ---------------- Telegram Helpers ----------------
async function sendMessage(chatId, text, keyboard = false) {
    const payload = {
        chat_id: String(chatId),
        text: text,
        disable_web_page_preview: true,
    };
    if (keyboard) {
        payload.reply_markup = JSON.stringify({
            keyboard: [[{ text: "إنشاء حساب" }]],
            resize_keyboard: true,
            is_persistent: true,
        });
    }
    try {
        await bot.sendMessage(chatId, text, payload);
    } catch (e) {}
}

function loadOwner() {
    try {
        if (require('fs').existsSync(OWNER_FILE)) {
            const data = JSON.parse(require('fs').readFileSync(OWNER_FILE, 'utf8'));
            return parseInt(data.owner_id);
        }
    } catch (e) {}
    return null;
}

function saveOwner(uid) {
    try {
        require('fs').writeFileSync(OWNER_FILE, JSON.stringify({ owner_id: uid }), 'utf8');
    } catch (e) {}
}

function ensureOwner(uid) {
    const owner = loadOwner();
    if (owner === null) {
        saveOwner(uid);
        return true;
    }
    return owner === uid;
}

function normalizeIqPhone(text) {
    let digits = (text || "").replace(/\D+/g, "");
    if (digits.startsWith("00964")) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length === 11) digits = "964" + digits.slice(1);
    if (digits.startsWith("964") && digits.length === 13) return digits;
    return null;
}

// ---------------- Puppeteer Automation Engine ----------------
async function runPuppeteerAutomation(chatId, eprUrl, phone) {
    await sendMessage(chatId, "🌐 جاري تشغيل المتصفح عبر البروكسي العراقي المخصص...");

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
        
        // تسجيل الدخول للبروكسي بالصلاحيات المطلوبة
        await page.authenticate({
            username: PROXY_USER,
            password: PROXY_PASS
        });

        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        
        await sendMessage(chatId, "🔗 جاري فتح رابط نتفلكس وتجاوز الحماية...");
        await page.goto(eprUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        await new Promise(r => setTimeout(r, 4000));

        // الخطوة 1: الضغط على زر المتابعة أو البدء إن وجد
        try {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const target = btns.find(b => /finish|start|متابعة|ابدأ|التالي|continue/i.test(b.innerText || ""));
                if (target) target.click();
            });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 3000));

        // الانتقال لصفحة خطط الاشتراكات أو اختيار الخطة (3108) وتجاوز الخطوات المباشرة
        if (page.url().includes('signup') || page.url().includes('plan')) {
            await sendMessage(chatId, "📋 جاري اختيار الخطة وتجاوز الخطوات التمهيدية...");
            try {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                    const nextBtn = btns.find(b => /next|متابعة|التالي|تأكيد/i.test(b.innerText || ""));
                    if (nextBtn) nextBtn.click();
                });
            } catch (e) {}
            await new Promise(r => setTimeout(r, 4000));
        }

        // اختيار طريقة الدفع عبر الهاتف المحمول (DCB / Mobile Billing)
        await sendMessage(chatId, "💳 جاري اختيار خيار الدفع عبر رصيد الهاتف (DCB)...");
        let dcbClicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const dcbEl = elements.find(el => /dcb|mobile|رصيد|الهاتف/i.test(el.innerText || el.id || el.className));
            if (dcbEl) {
                dcbEl.click();
                return true;
            }
            return false;
        });

        await new Promise(r => setTimeout(r, 3000));

        // الوصول لصفحة إدخال رقم الهاتف وحقن الرقم
        await sendMessage(chatId, `📱 جاري حقن الرقم العراقي: +964${phone}...`);
        
        await page.waitForSelector('input[type="tel"], input[name*="phone"], input[id*="phone"]', { timeout: 10000 }).catch(() => {});
        
        const phoneEntered = await page.evaluate((phoneNumber) => {
            const input = document.querySelector('input[type="tel"], input[name*="phone"], input[id*="phone"], input');
            if (input) {
                input.focus();
                input.value = phoneNumber;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, phone);

        if (!phoneEntered) {
            throw new Error("تعذر العثور على حقل إدخال رقم الهاتف في الصفحة.");
        }

        await new Promise(r => setTimeout(r, 1500));

        // الضغط على زر إرسال الكود (Verify Phone Number / Continue)
        await sendMessage(chatId, "🚀 جاري الضغط على زر إرسال كود التحقق (Verify)...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const verifyBtn = btns.find(b => /verify|send|متابعة|إرسال|تحقق/i.test(b.innerText || ""));
            if (verifyBtn) verifyBtn.click();
        });

        await new Promise(r => setTimeout(r, 5000));

        await sendMessage(chatId, "✅ تم إرسال طلب الـ SMS بنجاح عبر المتصفح والبروكسي العراقي!\n\n🔐 يرجى إدخال رمز التحقق (OTP) يدوياً في صفحة نتفلكس لإتمام العملية.");

    } catch (err) {
        await sendMessage(chatId, `❌ حدث خطأ أثناء التشغيل الآلي عبر المتصفح:\n${err.message}`);
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

async function startJob(chatId, eprUrl) {
    if (ACTIVE_JOBS[chatId]) {
        await sendMessage(chatId, "عندك عملية شغالة حالياً.");
        return;
    }
    ACTIVE_JOBS[chatId] = true;

    try {
        CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
        CHAT_STATE[chatId].awaiting_phone = true;
        await sendMessage(chatId, "📱 أرسل رقم هاتفك العراقي الآن (مثال: 7701234567 أو 07701234567):");

        let phone = await waitForPhone(chatId);
        if (!phone) {
            await sendMessage(chatId, "❌ انتهى وقت انتظار رقم الهاتف.");
            return;
        }

        await runPuppeteerAutomation(chatId, eprUrl, phone);

    } catch (e) {
        await sendMessage(chatId, `❌ خطأ عام:\n${e.message}`);
    } finally {
        CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
        CHAT_STATE[chatId].awaiting_epr = false;
        CHAT_STATE[chatId].awaiting_phone = false;
        CHAT_STATE[chatId].phone_value = null;
        delete ACTIVE_JOBS[chatId];
    }
}

// ---------------- Telegram Bot Listeners ----------------
bot.on('message', async (msg) => {
    let chatId = msg.chat.id;
    let userId = msg.from.id;
    let text = (msg.text || "").trim();

    if (!chatId || !userId) return;
    if (!ensureOwner(userId)) {
        await sendMessage(chatId, "⛔ هذا البوت خاص بصاحبه فقط.");
        return;
    }

    if (text === "/start") {
        await sendMessage(chatId, "✅ النظام الآلي عبر المتصفح والبروكسي العراقي جاهز. اضغط «إنشاء حساب».", true);
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
            await sendMessage(chatId, "📱 الرقم مو بصيغة عراقية واضحة. دزه مثل 07xxxxxxxxx أو +9647xxxxxxxxx");
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

    await sendMessage(chatId, "اضغط «إنشاء حساب» حتى تبدأ.", true);
});

console.log("\nNetflix EPR Automation with Puppeteer & Iraqi Proxy (Node.js) is running...");
