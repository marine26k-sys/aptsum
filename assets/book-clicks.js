// 추천 부동산 서적(쿠팡 파트너스 배너) 클릭 집계 — 2026.09 신규. index.html·subway-lines.html 공용.
//
// 배너는 쿠팡 iframe이라 그 안의 클릭 이벤트를 부모 페이지가 직접 받을 수 없다(다른 출처). 대신 iframe 안을
// 누르면 포커스가 iframe으로 넘어가며 부모 창에 blur가 발생하고 document.activeElement가 그 iframe이 되는 것을
// 이용해 "어느 책을 눌렀는지" 추정한다(마우스·터치 공통). 새 탭이 열리는 경우에도 blur가 먼저 발생한다.
// 추정치라 쿠팡 파트너스 리포트 수치와 조금 다를 수 있다(특히 일부 모바일 브라우저).
//
// 각 배너 칸에는 data-book="<쿠팡 링크 코드>"를 붙여 둔다(couponBannerHTML 참고). 페이지 구분은 <script data-page>.
(function () {
  var page = (document.currentScript && document.currentScript.dataset.page) || "index";
  var lastSent = {};

  function send(book) {
    var now = Date.now();
    if (lastSent[book] && now - lastSent[book] < 10000) return; // 같은 책 연속 감지(포커스 재진입 등) 중복 방지
    lastSent[book] = now;
    var body = JSON.stringify({ book: book, page: page });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/book-clicks", new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch("/api/book-clicks", { method: "POST", body: body, keepalive: true }); } catch (e) {}
  }

  function check() {
    var el = document.activeElement;
    if (!el || el.tagName !== "IFRAME") return;
    var item = el.closest && el.closest("[data-book]");
    if (!item) return;
    send(item.getAttribute("data-book"));
    // 포커스를 부모로 되돌려야 다음 클릭에서 다시 blur가 발생한다. 즉시 되돌리면 iframe 안 클릭 처리를
    // 방해할 수 있어 잠깐 기다린다.
    setTimeout(function () {
      if (document.activeElement === el) { try { el.blur(); window.focus(); } catch (e) {} }
    }, 1500);
  }

  // blur 시점엔 activeElement가 아직 안 바뀐 브라우저가 있어 다음 틱에 확인한다.
  window.addEventListener("blur", function () { setTimeout(check, 0); });
})();
