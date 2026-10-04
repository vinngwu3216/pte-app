// ================================================
// PTE 拼写练习 —— FIB 单词拼写 + WFD 句子挖空
// 数据在 data.js：FIB_WORDS、WFD_SENTENCES、WORD_ZH
// 每条数据的格式：[编号, 英文, 中文]
// ================================================

const app = document.getElementById("app");

// 两种模式的设置
const MODES = {
  fib: {
    name: "FIB",
    data: FIB_WORDS,
    unit: "个单词",
    groupSize: 20,
    quick: [["全部", 1, 225], ["预测", 1, 122], ["机经", 123, 225]],
  },
  wfd: {
    name: "WFD",
    data: WFD_SENTENCES,
    unit: "句",
    groupSize: 10,
    quick: [["全部", 1, 185], ["预测", 1, 31], ["机经", 32, 185]],
  },
};

// 当前练习的状态
let state = {
  mode: "fib",      // "fib" 或 "wfd"
  list: [],         // 这次要练的编号，比如 [1, 2, 3]
  index: 0,         // 现在练到第几个
  groupStart: null, // 如果是固定分组，记下这组的起始编号
  firstTry: true,   // 这个词是不是第一次检查
  right: 0,         // 本轮第一次就对的数量
  wrongNums: [],    // 本轮错的编号
  picked: [],       // WFD：被挖空的词的位置
  phase: "pick",    // WFD："pick" 选词阶段，"fill" 填空阶段
};

// ================================================
// 1. 数据存储（存到 Supabase，手机电脑同步）
// ================================================
// 连接 Supabase（网址和密钥在 config.js）
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null; // 现在登录的用户
let userData = {};      // 这个用户的所有数据：错词本、完成的分组、设置
let saveTimer = null;   // 等一会儿再上传，避免每打一个字母都上传

// 读数据（从内存里读）
function load(key, defaultValue) {
  return key in userData ? userData[key] : defaultValue;
}

// 存数据：先改内存，0.8 秒后上传到 Supabase
function save(key, value) {
  userData[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncNow, 800);
}

// 马上上传
async function syncNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!currentUser) return;
  const { error } = await sb.from("user_data").upsert({
    user_id: currentUser.id,
    data: userData,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("同步失败", error);
}

// 从 Supabase 下载这个用户的数据
async function fetchUserData() {
  const { data, error } = await sb
    .from("user_data")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    userData = data.data || {};
  } else {
    // 第一次登录：把这台电脑浏览器里以前的错词本搬上去
    userData = readOldLocalData();
    await syncNow();
  }
}

// 读以前存在浏览器里的旧数据（只在第一次登录时用一次）
function readOldLocalData() {
  const old = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("pte_")) old[key] = JSON.parse(localStorage.getItem(key));
    }
  } catch (e) {
    // 读不到就算了
  }
  return old;
}

// 切走页面时马上上传；切回来时重新下载（拿另一台设备的最新数据）
document.addEventListener("visibilitychange", () => {
  if (!currentUser) return;
  if (document.visibilityState === "hidden") {
    if (saveTimer) syncNow();
  } else if (!saveTimer) {
    fetchUserData().catch(e => console.error(e));
  }
});

// ================================================
// 1.5 登录页
// ================================================
function showLogin(message) {
  app.innerHTML = `
    <h1>PTE 拼写练习</h1>
    <div class="card">
      <h2>登录</h2>
      <label class="field">邮箱
        <input type="email" id="email" autocomplete="email">
      </label>
      <label class="field">密码
        <input type="password" id="password" autocomplete="current-password">
      </label>
      <div class="result bad" id="login-msg">${esc(message || "")}</div>
      <div class="actions">
        <button class="primary" id="login">登录</button>
        <button id="signup">注册新账号</button>
      </div>
      <p class="muted">第一次用，先填邮箱和密码，点"注册新账号"。密码至少 6 位。</p>
    </div>
  `;

  const msg = document.getElementById("login-msg");
  const getForm = () => ({
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  });

  function check(form) {
    if (!form.email || !form.password) {
      msg.textContent = "请填写邮箱和密码。";
      return false;
    }
    return true;
  }

  document.getElementById("login").onclick = async () => {
    const form = getForm();
    if (!check(form)) return;
    msg.textContent = "登录中…";
    const { data, error } = await sb.auth.signInWithPassword(form);
    if (error) msg.textContent = translateError(error.message);
    else afterLogin(data.user);
  };

  document.getElementById("signup").onclick = async () => {
    const form = getForm();
    if (!check(form)) return;
    msg.textContent = "注册中…";
    const { data, error } = await sb.auth.signUp(form);
    if (error) msg.textContent = translateError(error.message);
    else if (data.session) afterLogin(data.user);
    else msg.textContent = "注册成功，请去邮箱确认后再登录。";
  };

  document.getElementById("password").onkeydown = e => {
    if (e.key === "Enter") document.getElementById("login").click();
  };
}

// 把常见的英文错误翻成中文
function translateError(text) {
  if (/invalid login credentials/i.test(text)) return "邮箱或密码不对。";
  if (/already registered/i.test(text)) return "这个邮箱已经注册过了，直接点登录。";
  if (/at least 6/i.test(text)) return "密码至少 6 位。";
  if (/valid email|invalid format/i.test(text)) return "邮箱格式不对。";
  return "出错了：" + text;
}

// 登录成功后：下载数据，进首页
async function afterLogin(user) {
  currentUser = user;
  app.innerHTML = '<p class="muted center">加载中…</p>';
  try {
    await fetchUserData();
    showHome();
  } catch (e) {
    console.error(e);
    showLogin("数据加载失败，请再试一次。");
  }
}

async function logout() {
  await syncNow(); // 退出前先把没上传的数据传上去
  await sb.auth.signOut();
  currentUser = null;
  userData = {};
  showLogin();
}

// 错词本格式：{ 编号: { count: 错了几次, streak: 连续对了几次 } }
function getWrong(mode) {
  return load("pte_wrong_" + mode, {});
}

function recordAnswer(mode, num, correct) {
  const wrong = getWrong(mode);
  if (!correct) {
    const old = wrong[num] || { count: 0, streak: 0 };
    wrong[num] = { count: old.count + 1, streak: 0 };
  } else if (wrong[num]) {
    wrong[num].streak += 1;
    // 连续对 2 次，从错词本移出
    if (wrong[num].streak >= 2) delete wrong[num];
  }
  save("pte_wrong_" + mode, wrong);
}

function getSetting(name, defaultValue) {
  return load("pte_setting_" + name, defaultValue);
}

function setSetting(name, value) {
  save("pte_setting_" + name, value);
}

// ================================================
// 2. 发音（浏览器自带的语音）
// ================================================
function speak(text, rate) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate || 0.9;
  const voice = speechSynthesis.getVoices().find(v => v.lang === "en-US");
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ================================================
// 3. 小工具
// ================================================
function getItem(mode, num) {
  return MODES[mode].data[num - 1]; // 编号从 1 开始
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function range(from, to) {
  const nums = [];
  for (let i = from; i <= to; i++) nums.push(i);
  return nums;
}

// 防止英文里有特殊符号破坏页面
function esc(text) {
  return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ================================================
// 4. 首页
// ================================================
function showHome() {
  speechSynthesis.cancel();
  const fibWrong = Object.keys(getWrong("fib")).length;
  const wfdWrong = Object.keys(getWrong("wfd")).length;

  app.innerHTML = `
    <div class="topbar">
      <span>${esc(currentUser.email)}</span>
      <button id="logout">退出登录</button>
    </div>
    <h1>PTE 拼写练习</h1>
    <button class="big-box" id="go-fib">
      <div class="title">FIB</div>
      <div class="sub">225 个单词 · 错词 ${fibWrong} 个</div>
    </button>
    <button class="big-box" id="go-wfd">
      <div class="title">WFD</div>
      <div class="sub">185 句 · 错句 ${wfdWrong} 句</div>
    </button>
  `;
  document.getElementById("go-fib").onclick = () => showMenu("fib");
  document.getElementById("go-wfd").onclick = () => showMenu("wfd");
  document.getElementById("logout").onclick = logout;
}

// ================================================
// 5. 选择页（错词本 + 自选范围 + 固定分组）
// ================================================
function showMenu(mode) {
  speechSynthesis.cancel();
  const m = MODES[mode];
  const total = m.data.length;
  const wrongCount = Object.keys(getWrong(mode)).length;
  const done = load("pte_done_" + mode, []);
  const shuffleOn = getSetting("shuffle", false);

  // 固定分组按钮
  let groupsHtml = "";
  for (let start = 1; start <= total; start += m.groupSize) {
    const end = Math.min(start + m.groupSize - 1, total);
    const cls = done.includes(start) ? "done" : "";
    groupsHtml += `<button class="${cls}" data-start="${start}" data-end="${end}">${start}–${end}</button>`;
  }

  // 快捷按钮
  const quickHtml = m.quick
    .map(q => `<button class="chip" data-from="${q[1]}" data-to="${q[2]}">${q[0]} ${q[1]}–${q[2]}</button>`)
    .join("");

  app.innerHTML = `
    <div class="topbar">
      <button id="home">← 首页</button>
      <span>${m.name}</span>
    </div>

    <button class="card wrong-entry" id="wrong">
      <span>错词本</span><span>${wrongCount} ${m.unit}</span>
    </button>

    <div class="card">
      <h2>自选范围</h2>
      <div class="range-row">
        从 <input type="number" id="from" min="1" max="${total}" value="1">
        到 <input type="number" id="to" min="1" max="${total}" value="${Math.min(20, total)}">
        <button class="primary" id="start-range">开始</button>
      </div>
      <div class="chips">${quickHtml}</div>
      <label class="range-row" style="margin-top:12px;">
        <input type="checkbox" id="shuffle" ${shuffleOn ? "checked" : ""}> 打乱顺序
      </label>
      <div class="muted" id="range-msg"></div>
    </div>

    <div class="card">
      <h2>固定分组（每组 ${m.groupSize} ${m.unit}）</h2>
      <div class="groups">${groupsHtml}</div>
    </div>
  `;

  document.getElementById("home").onclick = showHome;
  document.getElementById("wrong").onclick = () => showWrongList(mode);
  document.getElementById("shuffle").onchange = e => setSetting("shuffle", e.target.checked);

  // 快捷按钮：填进"从…到…"
  app.querySelectorAll(".chip").forEach(btn => {
    btn.onclick = () => {
      document.getElementById("from").value = btn.dataset.from;
      document.getElementById("to").value = btn.dataset.to;
    };
  });

  document.getElementById("start-range").onclick = () => {
    const from = parseInt(document.getElementById("from").value, 10);
    const to = parseInt(document.getElementById("to").value, 10);
    if (!(from >= 1 && to <= total && from <= to)) {
      document.getElementById("range-msg").textContent = `请输入 1 到 ${total} 之间的数字，"从"要小于等于"到"。`;
      return;
    }
    startPractice(mode, range(from, to), null);
  };

  app.querySelectorAll(".groups button").forEach(btn => {
    btn.onclick = () => {
      const start = parseInt(btn.dataset.start, 10);
      const end = parseInt(btn.dataset.end, 10);
      startPractice(mode, range(start, end), start);
    };
  });
}

// ================================================
// 6. 错词本页面
// ================================================
function showWrongList(mode) {
  speechSynthesis.cancel();
  const m = MODES[mode];
  const wrong = getWrong(mode);
  // 错得多的排前面
  const nums = Object.keys(wrong).map(Number).sort((a, b) => wrong[b].count - wrong[a].count);

  let rows = "";
  nums.forEach(num => {
    const item = getItem(mode, num);
    rows += `
      <div class="list-row">
        <span class="en">${num}. ${esc(item[1])}</span>
        ${mode === "fib" ? `<span class="zh">${esc(item[2])}</span>` : ""}
        <span class="cnt">错 ${wrong[num].count} 次</span>
      </div>`;
  });

  app.innerHTML = `
    <div class="topbar">
      <button id="back">← 返回</button>
      <span>${m.name} 错词本 · 共 ${nums.length} ${m.unit}</span>
    </div>
    <div class="card">
      ${nums.length ? rows : '<p class="muted center">还没有错词。</p>'}
      <p class="muted">在练习里连续拼对 2 次，会自动移出错词本。</p>
    </div>
    <div class="actions">
      ${nums.length ? '<button class="primary" id="practice-wrong">开始练错词</button>' : ""}
      ${nums.length ? '<button id="clear">清空错词本</button>' : ""}
    </div>
  `;

  document.getElementById("back").onclick = () => showMenu(mode);
  if (nums.length) {
    document.getElementById("practice-wrong").onclick = () => startPractice(mode, nums, null);
    document.getElementById("clear").onclick = () => {
      if (confirm("确定清空错词本吗？")) {
        save("pte_wrong_" + mode, {});
        showWrongList(mode);
      }
    };
  }
}

// ================================================
// 7. 开始练习
// ================================================
function startPractice(mode, nums, groupStart) {
  const useShuffle = getSetting("shuffle", false);
  state.mode = mode;
  state.list = useShuffle ? shuffle(nums) : nums.slice();
  state.index = 0;
  state.groupStart = groupStart;
  state.right = 0;
  state.wrongNums = [];
  showCurrent();
}

function showCurrent() {
  state.firstTry = true;
  if (state.mode === "fib") renderFib();
  else renderWfd(true);
}

function nextItem() {
  state.index += 1;
  if (state.index >= state.list.length) showFinish();
  else showCurrent();
}

// 第一次检查时记录对错（之后改对不算）
function firstResult(correct) {
  if (!state.firstTry) return;
  state.firstTry = false;
  const num = state.list[state.index];
  recordAnswer(state.mode, num, correct);
  if (correct) state.right += 1;
  else state.wrongNums.push(num);
}

// 练习页上方：返回、进度、播放、中文
function practiceHeader(num, zh, label) {
  const showZh = getSetting("showZh", false);
  return `
    <div class="topbar">
      <button id="back">← 返回</button>
      <span>${label} ${state.index + 1} / ${state.list.length}</span>
    </div>
    <div class="card center">
      <button class="play-btn" id="play" title="播放">🔊</button>
      <div class="zh-row">
        <button id="toggle-zh">${showZh ? "隐藏中文" : "显示中文"}</button>
        <label class="muted"><input type="checkbox" id="always-zh" ${showZh ? "checked" : ""}> 一直显示</label>
      </div>
      <div class="zh-text" id="zh" style="visibility:${showZh ? "visible" : "hidden"}">${esc(zh)}</div>
  `;
}

function bindHeader(text, rate) {
  document.getElementById("back").onclick = () => showMenu(state.mode);
  document.getElementById("play").onclick = () => speak(text, rate);

  const zhBox = document.getElementById("zh");
  const toggleBtn = document.getElementById("toggle-zh");
  toggleBtn.onclick = () => {
    const hidden = zhBox.style.visibility === "hidden";
    zhBox.style.visibility = hidden ? "visible" : "hidden";
    toggleBtn.textContent = hidden ? "隐藏中文" : "显示中文";
  };
  document.getElementById("always-zh").onchange = e => {
    setSetting("showZh", e.target.checked);
    zhBox.style.visibility = e.target.checked ? "visible" : "hidden";
    toggleBtn.textContent = e.target.checked ? "隐藏中文" : "显示中文";
  };
}

// ================================================
// 8. FIB：单词拼写
// ================================================
function renderFib() {
  const num = state.list[state.index];
  const [, word, zh] = getItem("fib", num);

  // 找出哪些位置是字母（"-" 这种符号直接显示，不用打）
  const letterPos = [];
  for (let i = 0; i < word.length; i++) {
    if (/[a-z]/i.test(word[i])) letterPos.push(i);
  }
  const answer = letterPos.map(i => word[i].toLowerCase()).join("");

  // 下划线格子只负责显示；真正打字的是一个看不见的输入框（盖在格子上面）
  let slots = "";
  let k = 0;
  for (let i = 0; i < word.length; i++) {
    if (/[a-z]/i.test(word[i])) slots += `<span class="slot" data-k="${k++}"></span>`;
    else slots += `<span class="dash">${esc(word[i])}</span>`;
  }

  app.innerHTML = practiceHeader(num, zh, `FIB #${num} ·`) + `
      <div class="letters" id="letters">
        ${slots}
        <input id="typer" class="typer" maxlength="${answer.length}"
          autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      </div>
      <div class="result" id="result"></div>
      <div class="actions">
        <button id="show-answer">显示答案</button>
        <button class="primary" id="next">Next →</button>
      </div>
    </div>
  `;

  bindHeader(word, 0.9);
  speak(word, 0.9); // 自动播放

  const typer = document.getElementById("typer");
  const slotEls = Array.from(app.querySelectorAll("#letters .slot"));
  const result = document.getElementById("result");
  typer.focus();

  // 把输入框里的字母画到格子上
  function draw() {
    const typed = typer.value;
    slotEls.forEach((el, i) => {
      el.textContent = typed[i] || "";
      el.classList.toggle("current", i === typed.length);
    });
  }

  typer.oninput = () => {
    // 只留小写字母，长度不超过单词长度
    typer.value = typer.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, answer.length);
    slotEls.forEach(el => el.classList.remove("right", "wrong"));
    result.textContent = "";
    result.className = "result";
    draw();
    if (typer.value.length === answer.length) checkFib();
  };

  typer.onkeydown = e => {
    if (e.key === "Enter") checkFib();
  };

  function checkFib() {
    const typed = typer.value;
    let allRight = typed.length === answer.length;
    slotEls.forEach((el, i) => {
      const ok = typed[i] === answer[i];
      el.classList.add(ok ? "right" : "wrong");
      if (!ok) allRight = false;
    });

    firstResult(allRight);

    if (allRight) {
      result.textContent = "✓ 正确";
      result.className = "result ok";
      setTimeout(() => {
        // 还在同一个词才跳转（防止已经点了 Next）
        if (state.list[state.index] === num && app.contains(result)) nextItem();
      }, 900);
    } else {
      result.textContent = "✗ 红色字母错了，改一下再试";
      result.className = "result bad";
      // 选中第一个错的字母，直接打就能替换它
      const firstWrong = slotEls.findIndex(el => el.classList.contains("wrong"));
      typer.focus();
      if (firstWrong >= 0 && firstWrong < typed.length) typer.setSelectionRange(firstWrong, firstWrong + 1);
    }
  }

  document.getElementById("show-answer").onclick = () => {
    firstResult(false); // 看答案算错
    typer.value = answer;
    draw();
    slotEls.forEach(el => {
      el.classList.remove("wrong", "current");
      el.classList.add("right");
    });
    result.textContent = "答案：" + word;
    result.className = "result bad";
    document.getElementById("zh").style.visibility = "visible";
  };

  document.getElementById("next").onclick = nextItem;
  draw();
}

// ================================================
// 9. WFD：句子挖空
// ================================================

// 把句子拆成词：前标点 + 单词 + 后标点
function splitSentence(sentence) {
  return sentence.split(" ").map(token => {
    const m = token.match(/^([^A-Za-z]*)(.*?)([^A-Za-z]*)$/);
    return { pre: m[1], word: m[2], post: m[3] };
  });
}

// 随机挑 3 个较长的词（4 个字母以上）
function randomPick(tokens) {
  const candidates = [];
  tokens.forEach((t, i) => { if (t.word.length >= 4) candidates.push(i); });
  const count = Math.min(3, candidates.length);
  return shuffle(candidates).slice(0, count).sort((a, b) => a - b);
}

function renderWfd(isNewSentence) {
  const num = state.list[state.index];
  const [, sentence, zh] = getItem("wfd", num);
  const tokens = splitSentence(sentence);
  const pickMode = getSetting("wfdPick", "random"); // "random" 或 "manual"

  if (isNewSentence) {
    state.picked = pickMode === "random" ? randomPick(tokens) : [];
    state.phase = pickMode === "random" ? "fill" : "pick";
  }

  // 句子部分
  let sentenceHtml = "";
  tokens.forEach((t, i) => {
    const isBlank = state.picked.includes(i);
    if (state.phase === "pick") {
      sentenceHtml += `${esc(t.pre)}<span class="word ${isBlank ? "picked" : ""}" data-i="${i}">${esc(t.word)}</span>${esc(t.post)} `;
    } else if (isBlank) {
      const hint = WORD_ZH[t.word.toLowerCase()] || "";
      const width = Math.max(t.word.length + 1, 4);
      sentenceHtml += `${esc(t.pre)}<span class="blank">
          <input data-i="${i}" style="width:${width}ch" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
          <span class="hint">${esc(hint)}</span>
        </span>${esc(t.post)} `;
    } else {
      sentenceHtml += `${esc(t.pre + t.word + t.post)} `;
    }
  });

  // 按钮部分
  let buttons = "";
  if (state.phase === "pick") {
    buttons = `
      <button id="random">随机挖空</button>
      <button id="clear-pick">清空</button>
      <button class="primary" id="start-fill">开始填</button>
    `;
  } else {
    buttons = `
      <button id="check">检查</button>
      <button id="show-answer">显示答案</button>
      <button id="repick">重新选空</button>
      <button class="primary" id="next">Next →</button>
    `;
  }

  app.innerHTML = practiceHeader(num, zh, `WFD 第 ${num} 句 ·`) + `
      <div class="range-row muted" style="justify-content:center;">
        挖空方式：
        <label><input type="radio" name="pick" value="random" ${pickMode === "random" ? "checked" : ""}> 随机</label>
        <label><input type="radio" name="pick" value="manual" ${pickMode === "manual" ? "checked" : ""}> 自己选</label>
      </div>
      ${state.phase === "pick" ? '<p class="muted">点句子里的词，选中的词会变成空（黄色 = 已选）。</p>' : ""}
      <div class="sentence">${sentenceHtml}</div>
      <div class="result" id="result"></div>
      <div class="actions">${buttons}</div>
    </div>
  `;

  bindHeader(sentence, 0.85);
  if (isNewSentence) speak(sentence, 0.85); // 新句子自动播放

  // 切换挖空方式
  app.querySelectorAll('input[name="pick"]').forEach(radio => {
    radio.onchange = () => {
      setSetting("wfdPick", radio.value);
      renderWfd(true);
    };
  });

  if (state.phase === "pick") bindPickPhase(tokens);
  else bindFillPhase(tokens);
}

// 选词阶段
function bindPickPhase(tokens) {
  const result = document.getElementById("result");

  app.querySelectorAll(".word").forEach(span => {
    span.onclick = () => {
      const i = parseInt(span.dataset.i, 10);
      if (state.picked.includes(i)) state.picked = state.picked.filter(x => x !== i);
      else state.picked.push(i);
      span.classList.toggle("picked");
    };
  });

  document.getElementById("random").onclick = () => {
    state.picked = randomPick(tokens);
    renderWfd(false);
  };
  document.getElementById("clear-pick").onclick = () => {
    state.picked = [];
    renderWfd(false);
  };
  document.getElementById("start-fill").onclick = () => {
    if (state.picked.length === 0) {
      result.textContent = "先点至少一个词。";
      result.className = "result bad";
      return;
    }
    state.picked.sort((a, b) => a - b);
    state.phase = "fill";
    renderWfd(false);
  };
}

// 填空阶段
function bindFillPhase(tokens) {
  const inputs = Array.from(app.querySelectorAll(".blank input"));
  const result = document.getElementById("result");
  if (inputs[0]) inputs[0].focus();

  inputs.forEach((input, k) => {
    input.oninput = () => {
      input.classList.remove("right", "wrong");
      result.textContent = "";
      result.className = "result";
    };
    input.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (k < inputs.length - 1) inputs[k + 1].focus();
        else checkWfd();
      }
    };
  });

  function checkWfd() {
    const num = state.list[state.index];
    let allRight = true;
    inputs.forEach(input => {
      const answer = tokens[input.dataset.i].word.toLowerCase();
      const ok = input.value.trim().toLowerCase() === answer;
      input.classList.add(ok ? "right" : "wrong");
      if (!ok) allRight = false;
    });

    firstResult(allRight);

    if (allRight) {
      result.textContent = "✓ 正确";
      result.className = "result ok";
      setTimeout(() => {
        if (state.list[state.index] === num && app.contains(result)) nextItem();
      }, 1000);
    } else {
      result.textContent = "✗ 红色的空错了，改一下再试";
      result.className = "result bad";
      const firstWrong = inputs.find(x => x.classList.contains("wrong"));
      if (firstWrong) firstWrong.select();
    }
  }

  document.getElementById("check").onclick = checkWfd;

  document.getElementById("show-answer").onclick = () => {
    firstResult(false);
    inputs.forEach(input => {
      const answer = tokens[input.dataset.i].word;
      const box = input.parentElement;
      if (!box.querySelector(".answer")) {
        box.insertAdjacentHTML("beforeend", `<span class="answer">${esc(answer)}</span>`);
      }
    });
    result.textContent = "答案已显示在空下面";
    result.className = "result bad";
  };

  document.getElementById("repick").onclick = () => {
    state.phase = "pick";
    renderWfd(false);
  };

  document.getElementById("next").onclick = nextItem;
}

// ================================================
// 10. 一轮结束
// ================================================
function showFinish() {
  speechSynthesis.cancel();
  const m = MODES[state.mode];

  // 固定分组练完，打勾
  if (state.groupStart) {
    const done = load("pte_done_" + state.mode, []);
    if (!done.includes(state.groupStart)) {
      done.push(state.groupStart);
      save("pte_done_" + state.mode, done);
    }
  }

  const total = state.list.length;
  const wrongNums = state.wrongNums.slice();

  app.innerHTML = `
    <div class="card center">
      <h1>这一轮完成了</h1>
      <p style="font-size:18px;">一次就对：<b style="color:#2a7a3d">${state.right}</b> / ${total}</p>
      <p style="font-size:18px;">错了：<b style="color:#c03030">${wrongNums.length}</b></p>
      <div class="actions">
        <button id="again">再练一遍</button>
        ${wrongNums.length ? '<button class="primary" id="redo-wrong">练这轮错的</button>' : ""}
        <button id="back">返回 ${m.name}</button>
      </div>
    </div>
  `;

  const allNums = state.list.slice();
  document.getElementById("again").onclick = () => startPractice(state.mode, allNums, state.groupStart);
  document.getElementById("back").onclick = () => showMenu(state.mode);
  if (wrongNums.length) {
    document.getElementById("redo-wrong").onclick = () => startPractice(state.mode, wrongNums, null);
  }
}

// ================================================
// 启动：已登录就进首页，没登录就进登录页
// ================================================
// 有些浏览器的语音列表要等一下才加载
if ("speechSynthesis" in window) speechSynthesis.getVoices();

async function start() {
  app.innerHTML = '<p class="muted center">加载中…</p>';
  const { data } = await sb.auth.getSession();
  if (data.session) afterLogin(data.session.user);
  else showLogin();
}
start();