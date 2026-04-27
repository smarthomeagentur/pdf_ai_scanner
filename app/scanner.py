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

def scan_document(image_path, output_pdf_path, coords_str="", algorithm="color_enhanced"):
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

    # 5. Bild für Textoptimierung aufbereiten
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    if algorithm == "white_paper":
        # 5.1 Schattenrechnung "Weißes Papier" Scanner-Effekt (Background Normalization)
        # Erstellt ein Hintergrundbild (Morphologische Dilatation verwischt alle schwarzen Buchstaben komplett 
        # und behält nur das gräuliche Hintergrundpapier inklusive Schatten).
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        background = cv2.morphologyEx(warped_gray, cv2.MORPH_DILATE, kernel)
        
        # Teilen wir nun das originale Grau-Bild durch das berechnete Hintergrund-Papier:
        # -> Wo das Papier grau mit Schatten war, ist (grau / grau) = 1 (Also Weiß im Zielbild)
        # -> Wo Text war (dunkel / hell) = Ein Bereich nahe 0 (bleibt Schwarzbruch)
        diff = cv2.divide(warped_gray, background, scale=255)
        
        # 5.2 Lineare Kontrast-Streckung (Weißpunkt / Schwarzpunkt)
        black_point = 150
        white_point = 200
        
        processed = np.clip((diff.astype(np.float32) - black_point) * (255.0 / (white_point - black_point)), 0, 255).astype(np.uint8)

    elif algorithm == "color_enhanced":
        # Ausleuchtung (Schatten/Papierfarbe) schätzen
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        # Großer Kernel, um Texte zu "löschen" und nur das Papier übrig zu lassen
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
        background = cv2.morphologyEx(gray, cv2.MORPH_DILATE, kernel)
        background = cv2.GaussianBlur(background, (21, 21), 0)
        
        # Hintergrund auf 3 Kanäle erweitern
        bg_3c = cv2.cvtColor(background, cv2.COLOR_GRAY2BGR)
        
        # Bild durch Hintergrund teilen -> Macht das ungleichmäßig beleuchtete Blatt gleichmäßig weiß
        diff = cv2.divide(warped.astype(np.float32), bg_3c.astype(np.float32), scale=255.0)
        
        # Kontrast erhöhen (Schwarz- und Weißpunkt setzen)
        black_point = 25
        white_point = 230
        diff = np.clip((diff - black_point) * (255.0 / (white_point - black_point)), 0, 255).astype(np.uint8)
        
        # Sättigung leicht anheben für poppigere Farben (Logos, Stempel, Unterschriften)
        hsv = cv2.cvtColor(diff, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)
        s = cv2.multiply(s, 1.3) # Sättigung um 30% erhöhen
        s = np.clip(s, 0, 255).astype(np.uint8)
        hsv = cv2.merge([h, s, v])
        processed = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    elif algorithm == "bw_adaptive":

        # Herkömmlicher hart-schwarz-weiß-Modus (gut für sehr schwacht gedruckte Bons)
        #blurred = cv2.GaussianBlur(warped_gray, (5, 5), 0)
        processed = cv2.adaptiveThreshold(warped_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 15)

    elif algorithm == "grayscale":
        # Einfach Graustufen ohne Filter, optimal für Bilder 
        processed = warped_gray
        
    elif algorithm == "color":
        # Originalfarbe beibehalten (für Farbdokumente)
        processed = warped
        
    else:
        # Fallback
        processed = warped_gray

    # Falls nur eine einfache Vorschau (JPG) statt OCR PDF gewünscht ist
    output_ext = os.path.splitext(output_pdf_path)[1].lower()
    if output_ext in ['.jpg', '.jpeg', '.png']:
        cv2.imwrite(output_pdf_path, processed)
        print(f"Preview gespeichert in: {output_pdf_path}")
        return

    # 6. OCR mit Tesseract und als durchsuchbares PDF speichern
    # Maximale OCR-Qualität (Darf länger dauern):
    # - Kubische Interpolation skaliert das Bild um Faktor 2 hoch. Tesseract profitiert massiv davon (simuliert > 300 DPI). 
    # - --oem 1: Nutzt die moderne LSTM-Engine (Neuronale Netzwerke) von Tesseract.
    # - --psm 3: Pseudosmartes Dokument-Layout (Erkennt Spalten viel besser als purer Textmodus).
    # - preserve_interword_spaces=1: Leerzeichen bleiben erhalten und verschwinden nicht bei dicker Schrift.
    ocr_image = cv2.resize(processed, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    
    # PyTesseract konvertiert Numpy arrays per default als RGB, d.h. wenn wir ihm BGR übergeben, 
    # sind Rot und Blau vertauscht, und bei sehr dunklen Flächen gehen Mischfarben verloren / wirken entsättigt.
    if len(ocr_image.shape) == 3 and ocr_image.shape[2] == 3:
        ocr_image = cv2.cvtColor(ocr_image, cv2.COLOR_BGR2RGB)

    custom_config = r'--oem 1 --psm 3 -c preserve_interword_spaces=1'
    pdf_bytes = pytesseract.image_to_pdf_or_hocr(ocr_image, extension='pdf', lang='deu+eng', config=custom_config)
    with open(output_pdf_path, 'wb') as f:
        f.write(pdf_bytes)

    # Preview-Bild (Thumbnail) für das Frontend-Menü generieren
    # .pdf zu .jpg machen und Bild schreiben
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