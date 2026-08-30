const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');

// ==========================================
// الثوابت وإعدادات نتفلكس والبروكسي
// ==========================================
const PROXIES = {
    "http": "http://het95yha52718u9-country-iq:cwf2pqqblvu5ci5@rp.scrapegw.com:6060",
    "https": "http://het95yha52718u9-country-iq:cwf2pqqblvu5ci5@rp.scrapegw.com:6060"
};

function getDynamicCookies() {
    return {
        "_OT_sm": "87b6a5c0-0104-4e96-a291-092c11350111",
        "netflix-sans-bold-3-loaded": "true",
        "netflix-sans-normal-3-loaded": "true",
        "nfvdid": "BQFmAAEBEFGxrT9_8dyFnfgAtq7v_xhgB5IUwxosEj6z9zbtFKrPR-co3rgxxH06Jk-NF7xVvRSHAAe1WVxAZHA3mgALsUkMoIB9uBDuDQJzoslvSd3xgfEiSsEJDlSLLqOTOBWbGQoL5QVzwZWHp11kewdhOECH",
        "OptanonAlertBoxClosed": "2026-08-03T19:41:18.294Z",
        "OptanonConsent": "isGpcEnabled=0&datestamp=Mon+Aug+24+2026+20%3A44%3A00+GMT%2B0300+(Arabian+Standard+Time)&version=202607.1.0&browserGpcFlag=0&isDntEnabled=0&isIABGlobal=false&hosts=&consentId=7bd9e4d2-fb6b-4b53-9f19-5721c91464e3&interactionCount=2&isAnonUser=1&prevHadToken=0&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&fclco=&intType=3&crTime=1785786078984&geolocation=IQ%3BKA&AwaitingReconsent=false",
        "flwssn": uuidv4(),
        "gsid": uuidv4()
    };
}

function getCookieHeaderString(cookiesObj) {
    return Object.entries(cookiesObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

const USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
];

const SERVICE_NETFLIX = "nf";
const COUNTRY_IRAQ = "47";
const httpAgent = new HttpsProxyAgent(PROXIES.http);

// التوكن يُقرأ من المتغيرات البيئية كما طلبت
const BOT_TOKEN = process.env.BOT_TOKEN || "";
if (!BOT_TOKEN) {
    console.warn("⚠️ تحذير: BOT_TOKEN غير موجود في متغيرات البيئة!");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const PQ_MEMBERSHIP = "3f50f3b3-fff8-48c0-bbd3-5fa2cb04b3c1";
const PQ_INIT_SIGNUP = "59134b11-7416-42ca-abb7-6d1f318975fe";
const PQ_PRELOAD = "2eceeacc-e2fe-4157-82c2-6fcbec108525";
const PQ_SCREEN_UPDATE = "bf08eba4-da1b-4e3b-92e4-ceb2b7c1c27d";
const PQ_VERSION = 102;

const DEFAULT_APP_VERSION = "v622e5d08";
const DEFAULT_HAWKINS_VERSION = "5.26.0";
const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36";

const OWNER_FILE = require('path').join(require('os').homedir(), '.netflix_epr_bot_owner.json');
const TMPDIR = process.env.TMPDIR || "/data/data/com.termux/files/usr/tmp";

const CHAT_STATE = {};
const ACTIVE_JOBS = {};

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

// ---------------- Deep Walk & Utils ----------------

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

// ---------------- Netflix Direct Engine ----------------

class NetflixDirect {
    constructor() {
        this.client = axios.create({
            httpsAgent: httpAgent,
            proxy: false,
            timeout: 30000,
            maxRedirects: 5
        });
        this.appVersion = DEFAULT_APP_VERSION;
        this.hawkins = DEFAULT_HAWKINS_VERSION;
        this.referer = "https://www.netflix.com/";
        this.cookiesObj = getDynamicCookies();
    }

    async gql(operation, variables, persistedId, clientContext = null, referer = null, clcs = false) {
        let effectiveReferer = referer || this.referer;
        let headers = {
            "content-type": "application/json",
            "Origin": "https://www.netflix.com",
            "cookie": getCookieHeaderString(this.cookiesObj),
            "x-netflix.context.operation-name": operation,
            "x-netflix.context.ui-flavor": "akira",
            "x-netflix.context.locales": "en-us",
            "x-netflix.context.app-version": this.appVersion,
            "x-netflix.context.hawkins-version": this.hawkins,
            "x-netflix.request.attempt": "1",
            "x-netflix.request.id": require('crypto').randomBytes(16).toString('hex'),
            "x-netflix.request.originating.url": effectiveReferer,
            "x-netflix.request.toplevel.uuid": uuidv4(),
            "Referer": effectiveReferer,
        };
        if (clientContext) {
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
        let r = await this.client.post("https://www.netflix.com/graphql", payload, { headers });
        return r.data;
    }

    async membershipStatus() {
        try {
            let body = await this.gql("MembershipStatus", {}, PQ_MEMBERSHIP, { appstate: "foreground" }, this.referer);
            return nested_get(body, "data", "growthAccount", "membershipStatus");
        } catch (e) {
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
            let parsedUrl = new URL(url);
            let sParam = parsedUrl.searchParams.get("serverState");
            if (sParam) state = sParam;
        } catch (e) {}

        let mState = (text || "").match(/"serverState"\s*:\s*"([^"<>]{80,})"/);
        if (mState) state = mState[1];

        let mUpdate = (text || "").match(/"serverScreenUpdate"\s*:\s*"([^"<>]{80,})"/);
        if (mUpdate) update = mUpdate[1];

        return [state, update];
    }

    async openEprDirect(eprUrl) {
        let r = await this.client.get(eprUrl, {
            headers: {
                "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                "cookie": getCookieHeaderString(this.cookiesObj),
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "*/*"
            }
        });
        this.referer = r.request.res.responseUrl || eprUrl;
        this.discoverVersions(r.data || "");

        let ms = await this.membershipStatus();
        if (ms === "NEVER_MEMBER") return [true, "requests_get_only"];

        let [state, update] = this.extractBootstrapState(r.data || "", this.referer);
        if (!state || !update) return [false, "missing_epr_bootstrap_state"];

        try {
            let body = await this.gql("CLCSScreenUpdate", {
                format: "HTML",
                imageFormat: "PNG",
                locale: "en-US",
                serverState: state,
                serverScreenUpdate: update,
                inputFields: [],
            }, PQ_SCREEN_UPDATE, { appView: "PASSWORDLESS_REGISTRATION", action: "Submitted", appstate: "foreground" }, this.referer, true);

            this.referer = "https://www.netflix.com/?accountCreated=success";
            ms = await this.membershipStatus();
            if (ms === "NEVER_MEMBER") return [true, "requests_graphql_bootstrap"];
        } catch (e) {}
        return [false, "direct_bootstrap_not_confirmed"];
    }

    async preloadFromScreen(screen) {
        let preloadStates = screen.preload || [];
        if (preloadStates.length === 0) return [];
        let pre = await this.gql("CLCSPreloadScreens", { serverStates: preloadStates }, PQ_PRELOAD, { appstate: "foreground" }, "https://www.netflix.com/signup", true);
        return extractPreloadScreens(pre);
    }

    async initSignup() {
        let flwssn = this.cookiesObj.flwssn;
        if (!flwssn) throw new Error("ما لكيت flwssn بالجلسة بعد إنشاء الحساب");

        let init = await this.gql("CLCSWebInitSignup", {
            inputNode: "WELCOME",
            locale: "en-US",
            inputFields: [{ name: "flwssn", value: { stringValue: flwssn } }],
        }, PQ_INIT_SIGNUP, { appstate: "foreground" }, "https://www.netflix.com/?accountCreated=success", true);

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
        }, PQ_SCREEN_UPDATE, { appView: "planSelection", action: "Submitted", appstate: "foreground" }, "https://www.netflix.com/signup", true);

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
        }, PQ_SCREEN_UPDATE, { appView: "paymentPicker", action: "Submitted", appstate: "foreground" }, "https://www.netflix.com/signup", true);

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
        }, PQ_SCREEN_UPDATE, { appView: "ENTER_DCB", action: "Submitted", appstate: "foreground" }, "https://www.netflix.com/signup", true);

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
            }, PQ_SCREEN_UPDATE, { appView: "ENTER_DCB", appstate: "foreground" }, "https://www.netflix.com/signup", true);

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

// ---------------- Flow Management ----------------

const WAIT_COND = {};

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
    let eng = new NetflixDirect();
    let tAll = Date.now();
    await sendMessage(chatId, "⚡ V17 بدأ.\nأكمل المراحل السريعة بالكود المباشر، وبعد صفحة الهاتف راح أطلب منك الرقم.\nرمز OTP المرتبط بالفوترة يبقى إدخاله يدويًا داخل Netflix.");

    let [ok, mode] = await eng.openEprDirect(eprUrl);
    if (!ok) {
        throw new Error("فشل فتح رابط الـ EPR المباشر");
    }
    await sendMessage(chatId, `✅ 1/4 تم إنشاء/تثبيت جلسة الحساب (${((Date.now()-tAll)/1000).toFixed(1)}s)\nالمحرك: ${mode}`);

    let t = Date.now();
    let [initScreen, preloaded] = await eng.initSignup();
    let planScreen = findScreenByLogging(preloaded, "planSelection");
    if (!planScreen) {
        if (String(initScreen.loggingViewName || "").toLowerCase() === "planselection" || screenContainsType(initScreen, "CLCSPlanSelection")) {
            planScreen = initScreen;
        }
    }
    if (!planScreen) throw new Error("ما حصلت planSelection من CLCSPreloadScreens");
    await sendMessage(chatId, `✅ 2/4 تم فتح اختيار الخطة (${((Date.now()-t)/1000).toFixed(1)}s)`);

    t = Date.now();
    let paymentScreen = await eng.selectPlan(planScreen);
    if (String(paymentScreen.loggingViewName || "").toLowerCase() !== "paymentpicker") {
        let vals = extractTextValues(paymentScreen).join(" ").toLowerCase();
        if (!vals.includes("choose how to pay")) {
            throw new Error("بعد اختيار الخطة ما وصلنا paymentPicker");
        }
    }
    await sendMessage(chatId, `✅ 3/4 تم اختيار الخطة والوصول إلى Choose how to pay (${((Date.now()-t)/1000).toFixed(1)}s)`);

    t = Date.now();
    let phoneScreen = await eng.chooseMobileBill(paymentScreen);
    if (!looksLikePhoneEntry(phoneScreen)) {
        throw new Error("DCB رجع شاشة غير متوقعة");
    }
    await sendMessage(chatId, `✅ 4/4 وصلنا إلى صفحة رقم الهاتف (${((Date.now()-t)/1000).toFixed(1)}s)\n\n📱 دز رقمك العراقي هسه، مثلاً 07xxxxxxxxx أو +9647xxxxxxxxx`);

    let phone = await waitForPhone(chatId);
    if (!phone) throw new Error("انتهى وقت انتظار رقم الهاتف");

    await sendMessage(chatId, "✅ استلمت الرقم. هسه أرسل طلب Verify Phone Number وأتوقف عند مرحلة رمز التحقق.");
    let [otpScreen, status] = await eng.submitPhoneForDcb(phoneScreen, phone);

    let total = (Date.now() - tAll) / 1000;
    let detail = "";
    if (otpScreen && looksLikePaymentOtp(otpScreen)) {
        detail = "وصلت شاشة رمز التحقق.";
    } else if (otpScreen) {
        detail = `Netflix رجع شاشة جديدة: ${otpScreen.loggingViewName || 'unknown'}`;
    } else {
        detail = `تم إرسال Verify؛ الحالة: ${status}`;
    }

    await sendMessage(
        chatId,
        "📩 تم تنفيذ Verify Phone Number والوصول إلى مرحلة التحقق المرتبطة بالفوترة.\n" +
        `${detail}\n` +
        `⏱ الزمن الكلي: ${total.toFixed(1)} ثانية\n\n` +
        "🔐 رمز OTP هنا يعتبر موافقة دفع/فوترة، لذلك لا ترسله للبوت ولا راح أدخله تلقائيًا. دخله يدويًا داخل Netflix. الأداة توقفت هنا.",
        true
    );
}

async function runJob(chatId, eprUrl) {
    try {
        await fastFlow(chatId, eprUrl);
    } catch (exc) {
        await sendMessage(chatId, `❌ V17 توقف:\n${exc.name}: ${exc.message}`);
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
        await sendMessage(chatId, "📲 تم استلام الرقم. أكمل هسه...");
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
});

console.log("\nNetflix EPR Telegram V17 PHONE + VERIFY HANDOFF (Node.js)");
console.log("[+] Direct GraphQL + phone prompt; Verify can trigger payment MFA, OTP entry remains manual.");
