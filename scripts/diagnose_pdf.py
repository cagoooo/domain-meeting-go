"""徹底分析 PDF：image 在 PDF 上的位置 + image 內容像素尺寸"""
import sys, re
from pypdf import PdfReader
from PIL import Image
from io import BytesIO

p = sys.argv[1]
reader = PdfReader(p)

for idx, page in enumerate(reader.pages[:3]):
    mb = page.mediabox
    pw, ph = float(mb.width), float(mb.height)
    print(f"\n=== Page {idx + 1} ({pw:.0f} x {ph:.0f} pt) ===")

    stream = page.get_contents()
    if stream is None:
        print("  no content stream")
        continue
    data = stream.get_data().decode('latin-1', errors='ignore')

    matches = re.findall(
        r"([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+cm",
        data,
    )

    for m in matches:
        a, b, c, d, e, f = [float(x) for x in m]
        if abs(a) < 50 or abs(d) < 50:
            continue
        l_pt = e
        r_pt = pw - (e + a)
        print(f"  PDF image位置: w={a:.1f} h={abs(d):.1f}  x={e:.1f} y={f:.1f}")
        print(f"    左邊距 {l_pt * 0.3528:.2f} mm | 右邊距 {r_pt * 0.3528:.2f} mm | 偏移 {(l_pt - r_pt) * 0.3528:+.2f} mm")

    # 看 image 像素
    for j, img in enumerate(page.images):
        pil = Image.open(BytesIO(img.data))
        print(f"  image[{j}] {img.name}: {pil.size[0]}x{pil.size[1]} px")
        if j == 0:
            # 量這張圖左右邊有多少純白
            pil_rgb = pil.convert('RGB')
            w, h = pil.size
            mid_y = h // 2
            white = (250, 250, 250)
            # 左邊掃多少 px 是白的
            left_white = 0
            for x in range(w):
                r, g, b = pil_rgb.getpixel((x, mid_y))
                if r >= white[0] and g >= white[1] and b >= white[2]:
                    left_white += 1
                else:
                    break
            right_white = 0
            for x in range(w - 1, -1, -1):
                r, g, b = pil_rgb.getpixel((x, mid_y))
                if r >= white[0] and g >= white[1] and b >= white[2]:
                    right_white += 1
                else:
                    break
            print(f"    middle row 白邊: 左 {left_white}px / 右 {right_white}px")
