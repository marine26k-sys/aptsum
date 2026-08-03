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
W, H = 1200, 630
img = Image.new("RGB", (W, H), SLATE)
d = ImageDraw.Draw(img)

# navy header band
d.rectangle([0, 0, W, 210], fill=NAVY)

# logo mark (top-left of band)
lx, ly, s = 72, 68, 3.6
bars = [(7, 17, 12, 27, LOGO_TEAL), (14, 10, 19, 27, LOGO_TEAL_LIGHT), (21, 5, 26, 27, LOGO_TEAL)]
for x0, y0, x1, y1, c in bars:
    d.rounded_rectangle([lx + x0 * s, ly + y0 * s, lx + x1 * s, ly + y1 * s], radius=4, fill=c)

d.text((lx + 120, ly + 18), "아파트썸 실거래 분석", font=font(FONT_BLACK, 46), fill=WHITE)
d.text((lx + 120, ly + 78), "aptsum RTMS Lab", font=font(FONT_MED, 22), fill=LOGO_TEAL_LIGHT)

# body: value props (2026.07 — 탭이 9개로 늘어난 현재 구성에 맞게 갱신)
items = [
    "국토부 실거래가 데이터 기반 · 완전 무료",
    "단지 분석 · 비교 · 지역/거래량/등락 랭킹",
    "신고가 · 단기/반기/연간 저평가 단지 자동 감지",
]
y = 268
for line in items:
    d.ellipse([72, y + 14, 84, y + 26], fill=TEAL)
    d.text((104, y), line, font=font(FONT_BOLD, 32), fill=NAVY)
    y += 62

# mini chart motif (bottom-right) — simple upward line with dots
cx0, cy0, cx1, cy1 = 760, 300, 1120, 520
pts = [(cx0, 480), (cx0 + 120, 430), (cx0 + 240, 450), (cx0 + 360, 340)]
d.line(pts, fill=TEAL, width=6, joint="curve")
for p in pts:
    d.ellipse([p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8], fill=WHITE, outline=TEAL, width=5)
d.text((cx0, cy0 - 40), "월평균 시세 추이", font=font(FONT_BOLD, 24), fill=SUB)

d.text((72, H - 64), "aptsumprice.netlify.app", font=font(FONT_MED, 24), fill=SUB)

img.save("og-image.png")
print("done")
