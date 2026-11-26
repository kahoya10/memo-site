from PIL import Image, ImageChops, ImageOps


def glyph_signature(image):
    white = Image.new("RGBA", image.size, "white")
    ink = ImageOps.invert(Image.alpha_composite(white, image.convert("RGBA")).convert("L"))
    ink = ink.point(lambda value: 255 if value > 65 else 0)
    bounds = ink.getbbox()
    if not bounds:
        return None
    ink = ink.crop(bounds)
    if max(ink.size) < 8:
        return None
    padded = Image.new("L", (20, 20))
    scale = 18 / max(ink.size)
    ink = ink.resize(tuple(max(1, round(side * scale)) for side in ink.size), Image.Resampling.LANCZOS)
    padded.paste(ink, ((20 - ink.width) // 2, (20 - ink.height) // 2))
    return padded.tobytes()


def best_sample(image, samples):
    signature = glyph_signature(image)
    if not signature or not samples:
        return None
    target = Image.frombytes("L", (20, 20), signature)
    total_ink = sum(signature)
    distances = []
    for glyph, sample in samples:
        image_sample = Image.frombytes("L", (20, 20), bytes(sample))
        diff = ImageChops.difference(image_sample, target).histogram()
        distance = sum(value * count for value, count in enumerate(diff)) / (sum(sample) + total_ink)
        distances.append((distance, glyph))
    distances.sort()
    distance, glyph = distances[0]
    if distance <= .27 and (len(distances) == 1 or distances[1][0] - distance >= .055):
        return glyph
    return None


def personalize_blocks(image, blocks, samples, allow_single_glyph=False):
    if not samples:
        return blocks
    if not blocks and allow_single_glyph:
        glyph = best_sample(image, samples)
        if glyph:
            return [{"text": glyph, "bounds": [0, 0, 1, 1], "confidence": .5, "personalized": glyph}]
    for block in blocks:
        if block["confidence"] >= .7 or len(block["text"]) != 1:
            continue
        left, top, right, bottom = block["bounds"]
        if right <= left or bottom <= top:
            continue
        crop = image.crop((int(left * image.width), int(top * image.height), int(right * image.width), int(bottom * image.height)))
        glyph = best_sample(crop, samples)
        if glyph:
            block.update(text=glyph, personalized=glyph)
    return blocks
