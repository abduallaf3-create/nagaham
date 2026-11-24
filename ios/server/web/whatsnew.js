"use strict";
/* Nagham – "What's new": shown once after an update (the versions you skipped too), and from the menu under your name. */
const CHANGELOG = [
  { v: "3.19.0", items: [
    "الأغاني صارت تشتغل بدون يوتيوب ميوزك وبدون إعلانات — yt-dlp صار داخل التطبيق",
    "تقدر تحمّل الأغاني في الجوال: تنحفظ في الملفات ← Nagham ← Music بأسمائها وصورها",
    "شكل التطبيق تعدّل للجوال (الشريط فوق، الصفحة الرئيسية، صفحة المغني)",
    "تطبيق الجوال صار منفصل عن برنامج الكمبيوتر",
  ] },
  { v: "3.18.0", items: [
    "نغم صار له تطبيق آيفون! يتثبّت ببرنامج SideStore المجاني، والتحديثات توصله من SideStore",
    "نسخ احتياطية: بلاي لستاتك ولايكاتك والمغنين اللي تتابعهم وإعداداتك تنحفظ كل يوم لحالها، وتقدر تسوي نسخة وترجّعها من الإعدادات (About)",
  ] },
  { v: "3.17.0", items: [
    "تقدر تسوي Follow لأي مغني: من صفحته أو من البحث",
    "المغنين اللي تتابعهم يطلعون في القائمة الجانبية وفي المكتبة (Following)",
    "في الصفحة الرئيسية: \"Artists you follow\" و \"New from artists you follow\" — كل ألبوم أو سينقل نزل لهم آخر 4 شهور",
  ] },
  { v: "3.16.0", items: [
    "ابحث عن أي مغني ويطلع لك فوق: صورته، أشهر أغانيه، وكل ألبوماته وسينقلاته",
    "صفحة المغني فيها: الأشهر، كل الأغاني (من كل الألبومات، كل أغنية مرة وحدة)، الألبومات، والسينقلات",
    "تقدر تشغّل كل أغاني المغني أو تحمّلها كلها بضغطة",
    "مدة الأغاني تطلع كاملة بدل 0:30",
  ] },
  { v: "3.15.1", items: [
    "أداة التحميل تنزل بالخلفية أول ما تفتح التطبيق، فأول أغنية ما تنتظر",
    "زر Copy report جنب أي تحميل فاشل، و Report a problem في القائمة: ينسخ تقرير ترسله لمن يساعدك",
  ] },
  { v: "3.15.0", items: [
    "تحميل الأغاني من الروابط: يوتيوب، يوتيوب ميوزك، سبوتيفاي، Deezer، Apple Music، SoundCloud — الصق الرابط في بحث التحميل",
    "رابط ألبوم أو بلاي لست في بحث الأغاني يفتح أغانيه كلها تلقائياً",
    "إصلاح: الأغاني اللي أسماؤها عربي أو روسي كانت تتحمّل بس يطلع Failed",
    "نافذة \"وش الجديد\" بعد كل تحديث",
  ] },
  { v: "3.14.7", items: ["أداة التحميل تتحدّث لحالها كل 12 ساعة"] },
  { v: "3.14.6", items: ["لو فشل تحميل أغنية يعيد المحاولة تلقائياً بفيديو ثاني لنفس الأغنية", "تحديث أداة التحميل تلقائياً لما يتغيّر يوتيوب"] },
  { v: "3.14.5", items: ["الأغاني اللي تحمّلت قبل تاخذ غلافها الحقيقي واسمها الصحيح لحالها"] },
  { v: "3.14.4", items: ["الشريط اللي فوق صار دايم بلون الثيم"] },
  { v: "3.14.3", items: ["الدسكورد يعرض صورة الأغنية واسم الألبوم حتى للأغاني اللي على جهازك"] },
  { v: "3.14.2", items: ["إصلاح ظهور الأغنية في بروفايل الدسكورد، وزر Send a test"] },
  { v: "3.14.1", items: ["إصلاح الأسماء اللي كانت تصير NA", "الأغاني المحمّلة تاخذ غلاف الألبوم الحقيقي", "تحميل أسرع", "البلاي لستات الخاصة من يوتيوب ميوزك لما تربط حسابك"] },
  { v: "3.14.0", items: ["تحميل ألبومات وبلاي لستات كاملة بالبحث أو بالرابط", "زر تحميل الكل في صفحة أي بلاي لست"] },
  { v: "3.13.0", items: ["الـ Equalizer وصوت المغني صاروا يشتغلون على أغاني يوتيوب", "Top songs صار للعالم كله"] },
  { v: "3.12.0", items: ["الكاريوكي: لحن بس، وتسجيل فيديو وانت تغني"] },
];
function whatsNewItems(from, to) {
  return CHANGELOG.filter(c => (!from || newerVer(c.v, from)) && !newerVer(c.v, to));
}
function whatsNewHTML(from, to, max = 4) {
  const list = whatsNewItems(from, to).slice(0, max);
  if (!list.length) return "";
  return `<div class="wn-list" dir="rtl">${list.map(c => `<div class="wn-v"><b>${esc(c.v)}</b><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("")}</div>`;
}
function showWhatsNew() {
  const cur = UPD.current || CHANGELOG[0].v;
  modal(`<h3 style="margin:0 0 4px">What's new <span class="muted" style="font-size:15px;font-weight:400">وش الجديد</span></h3>
    <p class="muted" style="margin:0 0 12px">Nagham ${esc(cur)}</p>${whatsNewHTML("", cur, 8)}
    <div class="row-gap" style="justify-content:flex-end;margin-top:14px"><button class="btn accent ok">OK</button></div>`, () => true);
}
(() => {
  const st = document.createElement("style");
  st.textContent = `.wn-list{text-align:start;max-height:min(46vh,420px);overflow:auto;margin-top:14px;padding:4px 2px}
.wn-v{padding:10px 14px;border-radius:14px;background:rgba(127,127,127,.12);margin-bottom:8px}.wn-v b{display:inline-block;font-size:13px;padding:2px 9px;border-radius:999px;background:var(--accent);color:var(--on-accent);direction:ltr}
.wn-v ul{margin:8px 0 2px;padding-inline-start:20px;line-height:1.7;font-size:14.5px}#updOverlay .wn-list{width:100%;box-sizing:border-box;margin-inline:auto}`;
  document.head.appendChild(st);
})();
