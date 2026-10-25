// 모두의 일지 → 구글 시트 (회차별 탭). 사이트의 [시트에 올리기]가 이 웹 앱을 부른다.
// 설치 방법은 README의 "모두의 일지 시트 연결". 이 파일을 고치면 Apps Script에서 [배포 관리] → 새 버전으로 다시 배포해야 반영된다.
//
// 받는 값: { secret, tab: '2026.11', rows: [[머리글...], [칸...], ...] }  (수식 방지 '는 사이트에서 붙여 보낸다)
// 돌려주는 값: { ok: true, url } | { ok: false, error }

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || req.secret !== secret) return json_({ ok: false, error: 'UNAUTHORIZED' });
  if (!/^\d{4}\.\d{2}$/.test(req.tab) || !req.rows || !req.rows.length) return json_({ ok: false, error: 'BAD_REQUEST' });

  // 두 사람이 동시에 눌러도 한 탭씩 차례로 덮어쓴다
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // 새 회차 탭은 맨 앞에 (최신 회차가 앞)
    var sheet = ss.getSheetByName(req.tab) || ss.insertSheet(req.tab, 0);
    sheet.clearContents();
    sheet.getRange(1, 1, req.rows.length, req.rows[0].length).setValues(req.rows);
    sheet.setFrozenRows(1);
    return json_({ ok: true, url: ss.getUrl() + '#gid=' + sheet.getSheetId() });
  } finally {
    lock.releaseLock();
  }
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
