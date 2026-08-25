import sys
import cv2
import numpy as np
import pytesseract
import os

def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def four_point_transform(image, pts):
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))

    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))

    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped

def auto_exposure(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    min_val = np.percentile(gray, 1)
    max_val = np.percentile(gray, 99)
    if max_val > min_val:
        alpha = 255.0 / (max_val - min_val)
        beta = -min_val * alpha
        return cv2.convertScaleAbs(img, alpha=alpha, beta=beta)
    return img

def is_color_document(img):
    small = cv2.resize(img, (400, int(400 * img.shape[0] / img.shape[1])))
    small = cv2.GaussianBlur(small, (5, 5), 0)
    
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    bg = cv2.morphologyEx(small, cv2.MORPH_DILATE, kernel)
    diff = cv2.divide(small.astype(np.float32), bg.astype(np.float32), scale=255.0)
    diff = np.clip(diff, 0, 255).astype(np.uint8)
    
    hsv = cv2.cvtColor(diff, cv2.COLOR_BGR2HSV)
    _, s, v = cv2.split(hsv)
    
    color_mask = (s > 50) & (v < 220) & (v > 30)
    color_ratio = np.sum(color_mask) / (small.shape[0] * small.shape[1])
    return color_ratio > 0.01

def scan_document(image_path, output_pdf_path, coords_str="", algorithm="auto"):
    image = cv2.imread(image_path)
    if image is None:
        print("Fehler: Konnte Bild nicht laden.", file=sys.stderr)
        sys.exit(1)

    orig = image.copy()
    eval_warped = None

    if not coords_str or coords_str == "skip": 
        ratio = image.shape[0] / 500.0
        try:
            image_small = cv2.resize(image, (int(image.shape[1] / ratio), 500))

            gray = cv2.cvtColor(image_small, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)
            edged = cv2.Canny(gray, 75, 200)

            cnts, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
            screenCnt = None

            for c in cnts:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)
                if len(approx) == 4:
                    screenCnt = approx
                    break
        except Exception:
            screenCnt = None

        if screenCnt is None:
            warped = orig
        else:
            warped = four_point_transform(orig, screenCnt.reshape(4, 2) * ratio)
    elif coords_str == "frontend_cropped":
        warped = orig
    else:
        pts = np.array([float(x) for x in coords_str.split(',')]).reshape(4, 2)
        warped = four_point_transform(orig, pts)
        eval_warped = auto_exposure(warped.copy())

    warped = auto_exposure(warped)

    if algorithm == "auto":
        if eval_warped is not None:
            algorithm = "color_enhanced" if is_color_document(eval_warped) else "white_paper"
        else:
            algorithm = "color_enhanced" if is_color_document(warped) else "white_paper"
        print(f"Auto-Detect: Nutze Filter '{algorithm}'")

    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    if algorithm == "white_paper":
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        background = cv2.morphologyEx(warped_gray, cv2.MORPH_DILATE, kernel)
        diff = cv2.divide(warped_gray, background, scale=255)
        
        black_point = 150
        white_point = 200
        processed = np.clip((diff.astype(np.float32) - black_point) * (255.0 / (white_point - black_point)), 0, 255).astype(np.uint8)

    elif algorithm == "color_enhanced":
        h_orig, w_orig = warped.shape[:2]
        scale = 300.0 / max(h_orig, w_orig)
        small = cv2.resize(warped, (0, 0), fx=scale, fy=scale)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
        bg_estimate = cv2.morphologyEx(small, cv2.MORPH_DILATE, kernel)
        
        bg_smooth = cv2.GaussianBlur(bg_estimate, (51, 51), 0)
        bg_illumination = cv2.resize(bg_smooth, (w_orig, h_orig), interpolation=cv2.INTER_CUBIC)
        
        bg_illumination_f = bg_illumination.astype(np.float32)
        bg_illumination_f[bg_illumination_f == 0] = 1.0
        normalized = cv2.divide(warped.astype(np.float32), bg_illumination_f, scale=255.0)
        out = np.clip(normalized, 0, 255).astype(np.uint8)
        
        lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        l_float = l.astype(np.float32)
        black_p = 15
        white_p = 210
        l_float = np.clip((l_float - black_p) * (255.0 / (white_p - black_p)), 0, 255)
        l = l_float.astype(np.uint8)
        
        a_f = (a.astype(np.float32) - 128.0) * 1.1 + 128.0
        b_f = (b.astype(np.float32) - 128.0) * 1.1 + 128.0
        a = np.clip(a_f, 0, 255).astype(np.uint8)
        b = np.clip(b_f, 0, 255).astype(np.uint8)
        
        chroma = np.sqrt((a.astype(np.float32) - 128) ** 2 + (b.astype(np.float32) - 128) ** 2)
        is_color = chroma > 18

        paper_mask_final = (l > 230) & (~is_color)
        a[paper_mask_final] = 128
        b[paper_mask_final] = 128
        l[paper_mask_final] = 255
        
        lab = cv2.merge([l, a, b])
        processed = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        
        blur_for_sharp = cv2.GaussianBlur(processed, (0, 0), 1.5)
        processed = cv2.addWeighted(processed, 1.2, blur_for_sharp, -0.2, 0)

    elif algorithm == "bw_adaptive":
        processed = cv2.adaptiveThreshold(warped_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 15)

    elif algorithm == "grayscale":
        processed = warped_gray
        
    elif algorithm == "color":
        processed = warped
        
    else:
        processed = warped_gray

    output_ext = os.path.splitext(output_pdf_path)[1].lower()
    if output_ext in ['.jpg', '.jpeg', '.png']:
        cv2.imwrite(output_pdf_path, processed)
        print(f"Preview gespeichert in: {output_pdf_path}")
        return

    max_dim = 2500.0
    h, w = processed.shape[:2]
    
    if max(h, w) > max_dim:
        scale_factor = max_dim / max(h, w)
        ocr_image = cv2.resize(processed, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_AREA)
    else:
        ocr_image = processed.copy()

    if len(ocr_image.shape) == 3 and ocr_image.shape[2] == 3:
        ocr_image = cv2.cvtColor(ocr_image, cv2.COLOR_BGR2RGB)

    pdf_created = False
    for test_lang in ['deu+eng', 'deu', 'eng', None]:
        try:
            custom_config = r'--oem 1 --psm 3 -c preserve_interword_spaces=1'
            if test_lang:
                pdf_bytes = pytesseract.image_to_pdf_or_hocr(ocr_image, extension='pdf', lang=test_lang, config=custom_config)
            else:
                pdf_bytes = pytesseract.image_to_pdf_or_hocr(ocr_image, extension='pdf', config=custom_config)
            with open(output_pdf_path, 'wb') as f:
                f.write(pdf_bytes)
            pdf_created = True
            break
        except Exception as t_err:
            continue

    if not pdf_created:
        try:
            from PIL import Image
            if len(processed.shape) == 2:
                pil_img = Image.fromarray(processed)
            elif processed.shape[2] == 3:
                pil_img = Image.fromarray(cv2.cvtColor(processed, cv2.COLOR_BGR2RGB))
            else:
                pil_img = Image.fromarray(processed)
            pil_img.save(output_pdf_path, "PDF", resolution=150.0)
            pdf_created = True
        except Exception as pil_err:
            print(f"[SCANNER] Kritischer Fehler bei PDF-Erstellung: {pil_err}", file=sys.stderr)
            sys.exit(1)

    output_jpg_path = output_pdf_path.replace('.pdf', '.jpg')
    preview_img = cv2.resize(processed, (400, int(400 * (processed.shape[0] / processed.shape[1]))))
    cv2.imwrite(output_jpg_path, preview_img)

    print(f"Gespeichert in: {output_pdf_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Benutzung: python scanner.py <eingabe_bild> <ausgabe_pdf> [coords] [algorithm]")
        sys.exit(1)
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    coords = sys.argv[3] if len(sys.argv) > 3 else ""
    algorithm = sys.argv[4] if len(sys.argv) > 4 else "color_enhanced"
    scan_document(input_file, output_file, coords, algorithm)
