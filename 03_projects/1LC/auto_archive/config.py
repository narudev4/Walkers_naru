BASE_ID = "appksEWIuKl7N2ftS"

# テーブル
CHITAN_TABLE = "tbllNssTBXGexHysb"    # チタン物件一覧
RIREKI_TABLE = "tblMieyctX1o6LI7X"    # ★物件紹介履歴

# Phase 1: 物件の削除条件（90日超の滞留 OR 5,000万未満の不要物件）
PROPERTY_RETENTION_DAYS = 90
# 価格フィールドは円単位（5,000万円 = 50,000,000）
PROPERTY_FORMULA = "OR(IS_BEFORE({更新日}, DATEADD(TODAY(), -90, 'days')), {価格} < 50000000)"

PROPERTY_FIELDS = [
    "RECORD_ID", "更新日", "価格", "価格(表示)", "所在地", "公開用URL",
]

# Phase 2: 古い紹介履歴の独立削除
HISTORY_RETENTION_DAYS = 90
HISTORY_FORMULA = "IS_BEFORE({紹介日時}, DATEADD(TODAY(), -90, 'days'))"
HISTORY_BACKUP_FIELDS = ["紹介日時", "Name", "★個人投資家", "物件紹介_投資家"]

# 安全機構
MAX_DELETE_PER_PHASE = 60_000
ANOMALY_RATIO = 3.0
RECORD_ALERT_THRESHOLD = 110_000

# API 制約
API_BASE = "https://api.airtable.com/v0"
SLEEP = 0.25
DELETE_BATCH = 10
PAGE_SIZE = 100
MAX_RETRIES = 8
