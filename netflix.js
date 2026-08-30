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

// إعدادات البروكسي العراقي والمصادقة الصحيحة
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

const PQ_MEMBERSHIP = "3f50f3b3-fff8-48c0-bbd3-5fa2cb04b3c1";
const PQ_INIT_SIGNUP = "59134b11-7416-42ca-abb7-6d1f318975fe";
const PQ_PRELOAD = "2eceeacc-e2fe-4157-82c2-6fcbec108525";
const PQ_SCREEN_UPDATE = "bf08eba4-da1b-4e3b-92e4-ceb2b7c1c27d";
const PQ_VERSION = 102;

const DEFAULT_APP_VERSION = "v622e5d08";
const DEFAULT_HAWKINS_VERSION = "5.26.0";
const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36";

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

async function sendMessage(chatId, text, keyboard = false, replyMarkup = null) {
    let payload = {
        chat_id: String(chatId),
        text: text,
        disable_web_page_preview: "true",
    };
    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    } else if (keyboard) {
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
    } catch (exc) {
        await sendMessage(chatId, `[!] تعذر إرسال ملف التشخيص: ${exc.message}`);
    }
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

// ---------------- Helpers ----------------
function* deepWalk(obj) {
    if (obj && typeof obj === 'object') {
        yield obj;
        for (let v of Object.values(obj)) {
            yield* deepWalk(v);
        }
    } else if (Array.isArray(obj)) {
        for (let v of obj) {
            yield* deepWalk(v);
        }
    }
}

function nestedGet(obj, ...keys) {
    let cur = obj;
    for (let k of keys) {
        if (!cur || typeof cur !== 'object') return null;
        cur = cur[k];
    }
    return cur;
}

function findScreenByLogging(screens, loggingName) {
    for (let s of screens) {
        if (s && typeof s === 'object' && String(s.loggingViewName || "").toLowerCase() === loggingName.toLowerCase()) {
            return s;
        }
    }
    return null;
}

function screenContainsType(screen, typename) {
    for (let d of deepWalk(screen)) {
        if (d.__typename === typename || d.componentType === typename) return true;
    }
    return false;
}

function findNode(screen, { testId = null, loggingView = null, label = null, typename = null } = {}) {
    for (let d of deepWalk(screen)) {
        if (testId !== null && String(d.testId || "").toLowerCase() !== testId.toLowerCase()) continue;
        if (loggingView !== null && String(d.loggingViewName || "").toLowerCase() !== loggingView.toLowerCase()) continue;
        if (typename !== null && d.__typename !== typename && d.componentType !== typename) continue;
        if (label !== null) {
            let lbl = nestedGet(d, "label", "value");
            if (String(lbl || "").toLowerCase() !== label.toLowerCase()) continue;
        }
        return d;
    }
    return null;
}

function actionServerUpdate(node) {
    let onPress = node && typeof node === 'object' ? node.onPress : null;
    if (!onPress) return null;
    let candidates = [];
    for (let d of deepWalk(onPress)) {
        let ssu = d.serverScreenUpdate;
        if (typeof ssu === 'string' && ssu) {
            let score = 0;
            if (d.effectType === "CLCSRequestScreenUpdate" || d.__typename === "CLCSRequestScreenUpdate") score += 10;
            if (d.loggingAction === "Submitted") score += 5;
            candidates.push({ score, ssu });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].ssu;
}

function extractScreen(resp) {
    let s = nestedGet(resp, "data", "clcsWebInitSignup", "screen");
    if (s && typeof s === 'object') return s;
    s = nestedGet(resp, "data", "result", "screen");
    if (s && typeof s === 'object') return s;
    return null;
}

function extractPreloadScreens(resp) {
    let v = nestedGet(resp, "data", "clcsPreloadScreens");
    return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
}

function extractPlanValue(screen) {
    let node = findNode(screen, { typename: "CLCSPlanSelection" });
    if (node) {
        let v = nestedGet(node, "planField", "initialStringValue");
        if (typeof v === 'string' && v) return v;
        v = nestedGet(node, "planField", "initialSensitiveValue", "value");
        if (typeof v === 'string' && v) return v;
    }
    return "3108";
}

function extractTextValues(obj) {
    let out = [];
    for (let d of deepWalk(obj)) {
        for (let key of ["value", "loggingViewName", "testId", "screenName"]) {
            let v = d[key];
            if (typeof v === 'string') out.push(v);
        }
    }
    return out;
}

function looksLikePhoneEntry(screen) {
    if (screenContainsType(screen, "CLCSPaymentFormPhoneEntry") || screenContainsType(screen, "CLCSPhoneInput")) return true;
    let vals = extractTextValues(screen).join("\n").toLowerCase();
    return ["verify phone number", "mobile number", "phone number", "enter_dcb", "paymentdcb"].some(x => vals.includes(x));
}

function looksLikePaymentOtp(screen) {
    if (screenContainsType(screen, "CLCSPinEntry")) return true;
    let vals = extractTextValues(screen).join("\n").toLowerCase();
    return ["otp", "verification code", "enter code", "security code", "mfa", "one-time"].some(x => vals.includes(x));
}

function extractPollUpdate(resp) {
    for (let d of deepWalk(resp)) {
        if (d.__typename === "CLCSPollForScreenUpdate" || d.effectType === "CLCSPollForScreenUpdate") {
            let ssu = d.serverScreenUpdate;
            if (typeof ssu === 'string' && ssu) {
                let interval = 1000;
                try { interval = parseInt(d.intervalMs || 1000); } catch (e) {}
                return [ssu, Math.max(250, Math.min(interval, 3000))];
            }
        }
    }
    return [null, 1000];
}

function normalizeIqPhone(text) {
    let digits = (text || "").replace(/\D+/g, "");
    if (digits.startsWith("00964")) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length === 11) digits = "964" + digits.slice(1);
    if (digits.startsWith("964") && digits.length === 13) return digits;
    return null;
}

function safeSummary(obj) {
    if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) {
            return obj.slice(0, 20).map(x => safeSummary(x));
        }
        let out = {};
        for (let [k, v] of Object.entries(obj)) {
            let kl = k.toLowerCase();
            if (["cookie", "token", "password", "phone", "email", "serverstate", "serverscreenupdate", "authorization", "flwssn", "gsid"].some(x => kl.includes(x))) {
                out[k] = "<redacted>";
            } else if (["componenttree", "preload"].includes(kl)) {
                out[k] = "<omitted>";
            } else {
                out[k] = safeSummary(v);
            }
        }
        return out;
    }
    if (typeof obj === 'string' && obj.length > 500) {
        return obj.substring(0, 500) + "...";
    }
    return obj;
}

// ---------------- Netflix Direct Engine ----------------
class NetflixDirect {
    constructor() {
        this.client = axios.create({ timeout: 30000 });
        this.appVersion = DEFAULT_APP_VERSION;
        this.hawkins = DEFAULT_HAWKINS_VERSION;
        this.referer = `${NETFLIX}/`;
        this.debug = [];
        this.cookiesMap = {};
    }

    note(name, meta = {}) {
        this.debug.push({ ts: Date.now() / 1000, event: name, meta: safeSummary(meta) });
    }

    setCookie(name, value) {
        this.cookiesMap[name] = value;
    }

    getCookieHeader() {
        return Object.entries(this.cookiesMap).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async gql(operation, variables, persistedId, clientContext = null, referer = null, clcs = false) {
        let effectiveReferer = referer || this.referer;
        let headers = {
            "content-type": "application/json",
            "Origin": NETFLIX,
            "cookie": this.getCookieHeader(),
            "x-netflix.context.operation-name": operation,
            "x-netflix.context.ui-flavor": "akira",
            "x-netflix.context.locales": "en-us",
            "x-netflix.context.app-version": this.appVersion,
            "x-netflix.context.hawkins-version": this.hawkins,
            "x-netflix.request.attempt": "1",
            "x-netflix.request.id": crypto.randomBytes(16).toString('hex'),
            "x-netflix.request.originating.url": effectiveReferer,
            "x-netflix.request.toplevel.uuid": uuidv4(),
            "Referer": effectiveReferer,
            "User-Agent": DEFAULT_UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "*/*"
        };
        if (clientContext !== null) {
            headers["x-netflix.request.client.context"] = JSON.stringify(clientContext);
        }
        if (clcs) {
            headers["x-netflix.request.clcs.bucket"] = "high";
        }
        let payload = {
            operationName: operation,
            variables: variables,
            extensions: { persistedQuery: { id: persistedId, version: PQ_VERSION } },
        };
        let t0 = Date.now();
        let r = await this.client.post(GRAPHQL, payload, { headers });
        let elapsed = parseFloat(((Date.now() - t0) / 1000).toFixed(3));
        let body = r.data;
        this.note("graphql", { operation, status: r.status, elapsed, variables, response: body });
        return body;
    }

    async membershipStatus() {
        try {
            let body = await this.gql("MembershipStatus", {}, PQ_MEMBERSHIP, { appstate: "foreground" }, this.referer);
            return nestedGet(body, "data", "growthAccount", "membershipStatus");
        } catch (exc) {
            this.note("membership_error", { error: exc.message });
            return null;
        }
    }

    discoverVersions(text) {
        let m = (text || "").match(/"appVersion"\s*:\s*"(v[0-9A-Za-z]+)"/i);
        if (m) this.appVersion = m[1];
        m = (text || "").match(/"hawkinsVersion"\s*:\s*"([0-9.]+)"/i);
        if (m) this.hawkins = m[1];
    }

    extractBootstrapState(text, url) {
        let state = null;
        let update = null;
        try {
            let parsed = new URL(url);
            let sParam = parsed.searchParams.get("serverState");
            if (sParam) state = sParam;
        } catch (e) {}

        let mState = (text || "").match(/"serverState"\s*:\s*"([^"<>]{80,})"/);
        if (mState) state = mState[1];

        let mUpdate = (text || "").match(/"serverScreenUpdate"\s*:\s*"([^"<>]{80,})"/);
        if (mUpdate) update = mUpdate[1];

        return [state, update];
    }

    importPuppeteerCookies(cookies) {
        for (let c of cookies) {
            if (c.name && c.value !== undefined) {
                this.setCookie(c.name, c.value);
            }
        }
        this.referer = `${NETFLIX}/?accountCreated=success`;
        this.note("imported_browser_cookies", { count: cookies.length });
    }

    async preloadFromScreen(screen) {
        let preloadStates = screen.preload || [];
        if (preloadStates.length === 0) return [];
        let pre = await this.gql("CLCSPreloadScreens", { serverStates: preloadStates }, PQ_PRELOAD, { appstate: "foreground" }, `${NETFLIX}/signup`, true);
        return extractPreloadScreens(pre);
    }

    async initSignup() {
        let flwssn = this.cookiesMap["flwssn"];
        if (!flwssn) throw new Error("ما لكيت flwssn بالجلسة بعد إنشاء الحساب");

        let init = await this.gql("CLCSWebInitSignup", {
            inputNode: "WELCOME",
            locale: "en-US",
            inputFields: [{ name: "flwssn", value: { stringValue: flwssn } }],
        }, PQ_INIT_SIGNUP, { appstate: "foreground" }, `${NETFLIX}/?accountCreated=success`, true);

        let screen = extractScreen(init);
        if (!screen) throw new Error("CLCSWebInitSignup رجع بدون screen");
        return [screen, await this.preloadFromScreen(screen)];
    }

    async selectPlan(planScreen) {
        let planValue = extractPlanValue(planScreen);
        let button = findNode(planScreen, { testId: "cta-plan-selection" }) || findNode(planScreen, { label: "Next" });
        if (!button) throw new Error("ما لكيت زر Next الخاص بالخطة داخل CLCS");
        let update = actionServerUpdate(button);
        let state = planScreen.serverState;
        if (!state || !update) throw new Error("خطة Netflix ناقصها serverState/serverScreenUpdate");

        let body = await this.gql("CLCSScreenUpdate", {
            format: "HTML",
            imageFormat: "PNG",
            locale: "en-US",
            serverState: state,
            serverScreenUpdate: update,
            inputFields: [{ name: "planChoice", value: { stringValue: planValue } }],
        }, PQ_SCREEN_UPDATE, { appView: "planSelection", action: "Submitted", appstate: "foreground" }, `${NETFLIX}/signup`, true);

        let screen = extractScreen(body);
        if (!screen) throw new Error("اختيار الخطة ما رجع payment screen");
        return screen;
    }

    async chooseMobileBill(paymentScreen) {
        let dcb = findNode(paymentScreen, { testId: "DCB" }) || findNode(paymentScreen, { loggingView: "paymentDcb" });
        if (!dcb) throw new Error("ما لكيت DCB/paymentDcb داخل paymentPicker");
        let update = actionServerUpdate(dcb);
        let state = paymentScreen.serverState;
        if (!state || !update) throw new Error("paymentPicker ناقص serverState/serverScreenUpdate");

        let body = await this.gql("CLCSScreenUpdate", {
            format: "HTML",
            imageFormat: "PNG",
            locale: "en-US",
            serverState: state,
            serverScreenUpdate: update,
            inputFields: [],
        }, PQ_SCREEN_UPDATE, { appView: "paymentPicker", action: "Submitted", appstate: "foreground" }, `${NETFLIX}/signup`, true);

        let screen = extractScreen(body);
        if (!screen) throw new Error("اختيار Add to mobile bill ما رجع screen");
        return screen;
    }

    async submitPhoneForDcb(phoneScreen, phone) {
        let button = findNode(phoneScreen, { loggingView: "submitPaymentButton" }) || findNode(phoneScreen, { label: "Verify Phone Number" }) || findNode(phoneScreen, { testId: "cta-button" });
        if (!button) throw new Error("ما لكيت زر Verify Phone Number داخل ENTER_DCB");
        let update = actionServerUpdate(button);
        let state = phoneScreen.serverState;
        if (!state || !update) throw new Error("ENTER_DCB ناقص serverState/serverScreenUpdate");

        let body = await this.gql("CLCSScreenUpdate", {
            format: "HTML",
            imageFormat: "PNG",
            locale: "en-US",
            serverState: state,
            serverScreenUpdate: update,
            inputFields: [
                { name: "phoneNumber", value: { stringValue: phone } },
                { name: "countryCode", value: { stringValue: "IQ" } },
                { name: "paymentSubtype", value: { stringValue: "NA" } },
                { name: "partnerIntegrationUrl", value: { stringValue: "https://www.netflix.com/signup?serverCallback={serverCallback}" } },
                { name: "iAgree", value: { booleanValue: true } },
            ],
        }, PQ_SCREEN_UPDATE, { appView: "ENTER_DCB", action: "Submitted", appstate: "foreground" }, `${NETFLIX}/signup`, true);

        let screen = extractScreen(body);
        if (screen) return [screen, "screen"];

        let [pollUpdate, intervalMs] = extractPollUpdate(body);
        if (!pollUpdate) return [null, "submitted_no_screen"];

        let deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, intervalMs));
            let polled = await this.gql("CLCSScreenUpdate", {
                format: "HTML",
                imageFormat: "PNG",
                locale: "en-US",
                serverState: state,
                serverScreenUpdate: pollUpdate,
                inputFields: [],
            }, PQ_SCREEN_UPDATE, { appView: "ENTER_DCB", appstate: "foreground" }, `${NETFLIX}/signup`, true);

            screen = extractScreen(polled);
            if (screen) return [screen, "poll_screen"];
            let [nextUpdate, nextInterval] = extractPollUpdate(polled);
            if (nextUpdate) {
                pollUpdate = nextUpdate;
                intervalMs = nextInterval;
            } else {
                return [null, "submitted_poll_complete_without_screen"];
            }
        }
        return [null, "submitted_poll_timeout"];
    }
}

// ---------------- Puppeteer Browser Automation (Iraqi Proxy) ----------------
async function openAndProcessWithPuppeteer(chatId, eprUrl, phone) {
    await sendMessage(chatId, "🌐 جاري تشغيل المتصفح عبر البروكسي العراقي لفتح الرابط وإكمال الخطوات...");
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

        await page.setUserAgent(DEFAULT_UA);
        await sendMessage(chatId, "🔗 جاري فتح رابط EPR في المتصفح...");
        await page.goto(eprUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        await new Promise(r => setTimeout(r, 4000));

        // الضغط على المتابعة أو البدء
        try {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const target = btns.find(b => /finish|start|متابعة|ابدأ|التالي|continue/i.test(b.innerText || ""));
                if (target) target.click();
            });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 3000));

        if (page.url().includes('signup') || page.url().includes('plan')) {
            await sendMessage(chatId, "📋 جاري تخطي الخطوات واختيار الخطة عبر المتصفح...");
            try {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                    const nextBtn = btns.find(b => /next|متابعة|التالي|تأكيد/i.test(b.innerText || ""));
                    if (nextBtn) nextBtn.click();
                });
            } catch (e) {}
            await new Promise(r => setTimeout(r, 4000));
        }

        // اختيار الدفع عبر رصيد الهاتف (DCB)
        await sendMessage(chatId, "💳 اختيار طريقة الدفع عبر رصيد الهاتف (DCB)...");
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const dcbEl = elements.find(el => /dcb|mobile|رصيد|الهاتف/i.test(el.innerText || el.id || el.className));
            if (dcbEl) dcbEl.click();
        });

        await new Promise(r => setTimeout(r, 3000));

        // إدخال رقم الهاتف العراقي
        await sendMessage(chatId, `📱 حقن الرقم العراقي: +964${phone}...`);
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
            throw new Error("تعذر العثور على حقل إدخال رقم الهاتف في المتصفح.");
        }

        await new Promise(r => setTimeout(r, 1500));

        // الضغط على زر Verify
        await sendMessage(chatId, "🚀 الضغط على زر التحقق (Verify Phone Number)...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const verifyBtn = btns.find(b => /verify|send|متابعة|إرسال|تحقق/i.test(b.innerText || ""));
            if (verifyBtn) verifyBtn.click();
        });

        await new Promise(r => setTimeout(r, 5000));
        await sendMessage(chatId, "✅ تم إرسال طلب الـ SMS بنجاح عبر متصفح البروكسي العراقي!\n\n🔐 يرجى إدخال رمز التحقق (OTP) يدوياً في صفحة نتفلكس لإتمام العملية.");

    } catch (err) {
        await sendMessage(chatId, `❌ خطأ في المتصفح الآلي:\n${err.message}`);
    } finally {
        await browser.close();
    }
}

// ---------------- Fast Job Flow ----------------
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
        "⚡ V17 بدأ.\n" +
        "أطلب منك الآن رقم الهاتف العراقي لنقله وفتحه عبر متصفح البروكسي العراقي.\n" +
        "رمز OTP المرتبط بالفوترة يبقى إدخاله يدويًا داخل Netflix."
    );

    CHAT_STATE[chatId] = CHAT_STATE[chatId] || {};
    CHAT_STATE[chatId].awaiting_phone = true;
    await sendMessage(chatId, "📱 أرسل رقم هاتفك العراقي الآن (مثال: 7701234567 أو 07701234567):");

    let phone = await waitForPhone(chatId);
    if (!phone) {
        throw new Error("انتهى وقت انتظار رقم الهاتف");
    }

    await sendMessage(chatId, "✅ تم استلام الرقم. جاري فتح المتصفح عبر البروكسي العراقي وتنفيذ الخطوات...");
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
        await sendMessage(chatId, `❌ V17 توقف:\n${exc.name}: ${exc.message}`);
        await sendDocument(chatId, errPath, "تشخيص V17 المختصر");
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
    console.log("\nNetflix EPR Telegram V17 PHONE + VERIFY HANDOFF (Node.js)")
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
    let chatId = nestedGet(msg, "chat", "id");
    let userId = nestedGet(msg, "from", "id");
    let text = String(nestedGet(msg, "text") || "").trim();

    if (!chatId || !userId) return;
    if (!ensureOwner(userId)) {
        await sendMessage(chatId, "⛔ هذا البوت خاص بصاحبه فقط.");
        return;
    }

    if (text === "/start") {
        await sendMessage(chatId, "✅ V17 Phone + Verify Handoff جاهز. اضغط «إنشاء حساب».", true);
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
        await sendMessage(chatId, "📲 تم استلام الرقم. جاري المعالجة...");
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
