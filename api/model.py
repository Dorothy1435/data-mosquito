# 모기제로 모델 v5 서버 함수 (Vercel Python)
# -------------------------------------------------------------
# 역할: 저장소 주인이 만든 파이썬 모델(mosquito_model_portable.py, v5 실측 학습 모형)을 그대로 돌려
#       김해 17개 구역의 오늘 모기지수를 JSON 으로 준다. 브라우저의 model-v5.js 가 받아 쓴다.
# 원칙
#   · 모델 파일은 손대지 않는다. 주인이 파일을 갱신하면 그대로 반영된다.
#   · 날씨는 모델이 Open-Meteo 에서 직접 받는다(최근 31일 일별). 호출 결과는 Vercel 에지에서 30분 저장되어
#     방문자가 많아도 Open-Meteo 호출은 30분에 한 번꼴이다.
#   · 실패하면 { ok: false } 를 돌려주고, 브라우저는 v4(자바스크립트) 모델로 계속 동작한다.
# 로컬 시험: python api/model.py  → JSON 출력
import json
import os
import sys
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def compute():
    import mosquito_model_portable as m
    rows = m.all_indices(live_weather=True)
    live = any(r.get('weather', {}).get('observed') for r in rows)
    return {
        'ok': True,
        'model': 'v5',
        'live_weather': live,
        'date': rows[0].get('date') if rows else datetime.date.today().isoformat(),
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'districts': rows,
    }


def payload():
    try:
        return 200, compute()
    except Exception as e:  # 모델·날씨 어느 쪽이 실패해도 사이트는 v4로 계속 간다
        return 200, {'ok': False, 'model': 'v5', 'error': str(e)[:200]}


try:
    from http.server import BaseHTTPRequestHandler

    class handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, body = payload()
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            # 에지 캐시 30분, 그 뒤 1시간은 옛 값을 주면서 뒤에서 갱신
            self.send_header('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600'
                             if body.get('ok') else 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):  # 접속 기록에 아무것도 남기지 않는다
            pass
except Exception:
    pass


if __name__ == '__main__':
    _, body = payload()
    sys.stdout.reconfigure(encoding='utf-8')   # 윈도우 콘솔(cp949)에서도 한글·특수문자가 깨지지 않게
    print(json.dumps(body, ensure_ascii=False))
