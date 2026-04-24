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

def scan_document(image_path, output_pdf_path, coords_str=""):
    # 1. Bild laden...
    image = cv2.imread(image_path)
    if image is None:
        print("Fehler: Konnte Bild nicht laden.", file=sys.stderr)
        sys.exit(1)

    orig = image.copy()

    # Die perspektivische Korrektur (Entzerrung + Zuschneiden) haben wir 
    # bereits im Frontend in 1920x1080 (bzw hochauflösend) vorgenommen!
    # Daher ist 'orig' von nun an das bereinigte Rechteck und wir müssen keine
    # "coords" Fallbacks mehr durchführen - außer das System hat im Frontend nicht getriggert.

    if not coords_str: 
        # Optional: Falls jemand ohne Kantenfindung geklickt hat..
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
    else:
        # Die Datei ist bereits der beschnittene Bereich aus dem Frontend
        warped = orig

    # 5. Bild für Textoptimierung aufbereiten (Graustufen & Kontrast)
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    # 5.1 Kontrast erhöhen statt hartem Schwarz-Weiß-Filter
    # Wir nutzen CLAHE (Contrast Limited Adaptive Histogram Equalization) 
    # Dadurch bleiben kleine Details der Buchstaben erhalten, Schatten verschwinden trotzdem meist.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(warped_gray)
    
    # 5.2 Scharfzeichnen der Buchstaben
    kernel = np.array([[0, -1, 0], 
                       [-1, 5,-1], 
                       [0, -1, 0]])
    processed = cv2.filter2D(enhanced, -1, kernel)

    # 6. OCR mit Tesseract und als durchsuchbares PDF speichern
    pdf_bytes = pytesseract.image_to_pdf_or_hocr(processed, extension='pdf', lang='deu+eng')
    with open(output_pdf_path, 'wb') as f:
        f.write(pdf_bytes)

    print(f"Gespeichert in: {output_pdf_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Benutzung: python scanner.py <eingabe_bild> <ausgabe_pdf> [coords]")
        sys.exit(1)
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    coords = sys.argv[3] if len(sys.argv) > 3 else ""
    scan_document(input_file, output_file, coords)