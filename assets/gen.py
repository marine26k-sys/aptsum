from PIL import Image, ImageDraw, ImageFont

TEAL = (0, 130, 138)
TEAL_DARK = (0, 86, 92)
NAVY = (15, 43, 61)
SLATE = (241, 245, 249)
WHITE = (255, 255, 255)
SUB = (100, 116, 139)
# 2026.07: 헤더/공유 로고를 앱 상단 타이틀 로고(v136)와 동일한 색으로 통일
LOGO_TEAL = (0, 169, 180)     # #00A9B4
LOGO_TEAL_LIGHT = (127, 212, 217)  # #7FD4D9

FONT_BLACK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_MED = "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"
KR_IDX = 1  # Noto Sans CJK KR within collection


def font(path, size):
    return ImageFont.truetype(path, size, index=KR_IDX)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


# ── App icons (192 / 512 / apple-touch 180) ──
def make_icon(size, corner_ratio, out, bg=NAVY, pad_ratio=0.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * corner_ratio)
    d.rounded_rectangle([0, 0, size, size], radius=r, fill=bg)
    # three bars, same proportions as favicon (32-wide grid)
    def sx(v): return v / 32 * size
    bars = [
        (sx(7), sx(17), sx(12), sx(27), TEAL),
        (sx(14), sx(10), sx(19), sx(27), WHITE),
        (sx(21), sx(5), sx(26), sx(27), TEAL),
    ]
    br = max(1, int(size * 1.2 / 32))
    for x0, y0, x1, y1, c in bars:
        d.rounded_rectangle([x0, y0, x1, y1], radius=br, fill=c)
    img.save(out)


make_icon(192, 0.22, "icon-192.png")
make_icon(512, 0.22, "icon-512.png")
# apple touch icon: iOS applies its own mask, ship a full-bleed square, no transparency
make_icon(180, 0.0, "apple-touch-icon.png")
im = Image.open("apple-touch-icon.png").convert("RGB")
im.save("apple-touch-icon.png")

# ── OG share image 1200x630 ──
# 2026.08: 상단을 전체 폭 네이비 띠에서 앱 실제 헤더와 동일한 "알약형 배지" 로고로 교체.
# 부제("aptsum RTMS Lab")는 실제 앱 헤더에 없는 문구라 제거 — 로고 양식·내용을 현재 앱 헤더와 일치시킴.
W, H = 1200, 630
img = Image.new("RGB", (W, H), SLATE)
d = ImageDraw.Draw(img)

MX = 72  # 좌측 여백 (본문 요소들과 동일한 기준선)

# 배지 내부 로고 아이콘 + 텍스트 크기 측정
badge_font = font(FONT_BLACK, 40)
badge_text = "아파트썸 실거래 분석"
tb = d.textbbox((0, 0), badge_text, font=badge_font)
text_w, text_h = tb[2] - tb[0], tb[3] - tb[1]

icon_s = 3.1  # 32-grid 아이콘 스케일
icon_w = (26 - 7) * icon_s
icon_h = (27 - 5) * icon_s

pad_x, pad_y, gap = 28, 20, 14
badge_h = icon_h + pad_y * 2
badge_w = pad_x + icon_w + gap + text_w + pad_x
badge_x0, badge_y0 = MX, 50
badge_x1, badge_y1 = badge_x0 + badge_w, badge_y0 + badge_h

d.rounded_rectangle([badge_x0, badge_y0, badge_x1, badge_y1], radius=18, fill=NAVY)

lx = badge_x0 + pad_x
ly = badge_y0 + (badge_h - icon_h) / 2
bars = [(7, 17, 12, 27, LOGO_TEAL), (14, 10, 19, 27, LOGO_TEAL_LIGHT), (21, 5, 26, 27, LOGO_TEAL)]
for x0, y0, x1, y1, c in bars:
    d.rounded_rectangle([lx + (x0 - 7) * icon_s, ly + (y0 - 5) * icon_s,
                          lx + (x1 - 7) * icon_s, ly + (y1 - 5) * icon_s], radius=4, fill=c)

tx = lx + icon_w + gap
ty = badge_y0 + (badge_h - text_h) / 2 - tb[1]
d.text((tx, ty), badge_text, font=badge_font, fill=WHITE)

# body: value props (2026.07 — 탭이 9개로 늘어난 현재 구성에 맞게 갱신)
items = [
    "국토부 실거래가 데이터 기반 · 완전 무료",
    "단지 분석 · 비교 · 지역/거래량/등락 랭킹",
    "신고가 · 단기/반기/연간 저평가 단지 자동 감지",
]
y = badge_y1 + 78
for line in items:
    d.ellipse([MX, y + 14, MX + 12, y + 26], fill=TEAL)
    d.text((MX + 32, y), line, font=font(FONT_BOLD, 32), fill=NAVY)
    y += 62

# mini chart motif (bottom-right) — simple upward line with dots
cx0, cy0 = 760, 300
pts = [(cx0, 480), (cx0 + 120, 430), (cx0 + 240, 450), (cx0 + 360, 340)]
d.line(pts, fill=TEAL, width=6, joint="curve")
for p in pts:
    d.ellipse([p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8], fill=WHITE, outline=TEAL, width=5)
d.text((cx0, cy0 - 40), "월평균 시세 추이", font=font(FONT_BOLD, 24), fill=SUB)

d.text((MX, H - 64), "aptsumprice.netlify.app", font=font(FONT_MED, 24), fill=SUB)

img.save("og-image.png")
print("done")
