import sys
import os
import fitz

def compress_pdf(input_path, output_path, target_max_bytes=3.5 * 1024 * 1024):
    if not os.path.exists(input_path):
        sys.exit(1)

    initial_size = os.path.getsize(input_path)
    print(f"[COMPRESS] Eingangsspeichermenge: {initial_size} Bytes ({(initial_size / (1024*1024)):.2f} MB)")

    # 1. Versuch: Verlustfreie Komprimierung & Garbage Collection
    try:
        doc = fitz.open(input_path)
        doc.save(output_path, garbage=4, deflate=True, clean=True)
        doc.close()
        current_size = os.path.getsize(output_path)
        if current_size <= target_max_bytes:
            print(f"[COMPRESS] Verlustfrei reduziert auf {current_size} Bytes ({(current_size / (1024*1024)):.2f} MB)")
            sys.exit(0)
    except Exception as e:
        print(f"[COMPRESS] Fehler bei verlustfreiem Versuch: {e}")

    # Multi-Pass Bild-Re-rendering bei größeren PDF-Dateien
    passes = [
        {"dpi": 130, "quality": 70},
        {"dpi": 100, "quality": 60},
        {"dpi": 80,  "quality": 50},
        {"dpi": 65,  "quality": 40},
    ]

    for p in passes:
        dpi = p["dpi"]
        quality = p["quality"]
        try:
            doc = fitz.open(input_path)
            new_doc = fitz.open()

            for page in doc:
                pix = page.get_pixmap(dpi=dpi)
                img_bytes = pix.tobytes("jpeg", jpg_quality=quality)
                img_doc = fitz.open("jpeg", img_bytes)
                pdf_bytes = img_doc.convert_to_pdf()
                img_doc.close()
                img_pdf = fitz.open("pdf", pdf_bytes)
                new_doc.insert_pdf(img_pdf)
                img_pdf.close()

            new_doc.save(output_path, garbage=4, deflate=True)
            new_doc.close()
            doc.close()

            current_size = os.path.getsize(output_path)
            print(f"[COMPRESS] Pass (dpi={dpi}, q={quality}) -> {current_size} Bytes ({(current_size / (1024*1024)):.2f} MB)")
            if current_size <= target_max_bytes:
                sys.exit(0)
        except Exception as err:
            print(f"[COMPRESS] Pass (dpi={dpi}) Fehler: {err}")

    # Fallback End-Ergebnis
    final_size = os.path.getsize(output_path) if os.path.exists(output_path) else initial_size
    print(f"[COMPRESS] Endergebnis: {final_size} Bytes ({(final_size / (1024*1024)):.2f} MB)")
    sys.exit(0)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python compress_pdf.py <input.pdf> <output.pdf>")
        sys.exit(1)
    compress_pdf(sys.argv[1], sys.argv[2])
