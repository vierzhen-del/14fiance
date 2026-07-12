// 실행 중인 서버에 데일리 리포트 생성을 요청한다: npm run report
import "dotenv/config";

const port = process.env.PORT ?? 3000;
try {
  const res = await fetch(`http://localhost:${port}/api/report`, { method: "POST" });
  const json = await res.json();
  if (!json.ok) {
    console.error(`리포트 생성 실패: ${json.error}`);
    process.exit(1);
  }
  console.log(`리포트 저장: ${json.file}`);
  if (json.notionUrl) console.log(`노션 게시: ${json.notionUrl}`);
  if (json.notionError) console.warn(`노션 게시 실패: ${json.notionError}`);
} catch {
  console.error(`서버(localhost:${port})에 연결할 수 없습니다 — npm start 로 서버를 먼저 실행하세요`);
  process.exit(1);
}
