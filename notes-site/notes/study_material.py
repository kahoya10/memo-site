def marked_regions(strokes, role):
    regions = []
    seen = set()
    for index, stroke in enumerate(strokes):
        if not isinstance(stroke, dict) or stroke.get("study_role") != role:
            continue
        if role == "blank" and stroke.get("tool") != "highlighter":
            continue
        stroke_points = stroke.get("points")
        if not isinstance(stroke_points, list):
            continue
        points = [point for point in stroke_points if isinstance(point, list) and len(point) >= 2
                  and all(isinstance(value, (int, float)) and -1 <= value <= 2 for value in point[:2])]
        if not points:
            continue
        width = stroke.get("width", 18)
        width = min(40, max(1, width)) if isinstance(width, (int, float)) else 18
        inset_x = max(.012, width / 794)
        inset_y = max(.015, width / 1123)
        left = max(0, min(x for x, *_ in points) - inset_x)
        right = min(1, max(x for x, *_ in points) + inset_x)
        top_inset = max(.025, inset_y) if role == "card" and stroke.get("tool") != "highlighter" else inset_y
        top = max(0, min(y for _, y, *_ in points) - top_inset)
        bottom = min(1, max(y for _, y, *_ in points) + inset_y)
        if right > left and bottom > top:
            key = str(stroke.get("id") or index)[:80]
            while key in seen:
                key = f"{index}:{key}"[:80]
            seen.add(key)
            regions.append({"id": key, "bounds": [left, top, right, bottom]})
            if len(regions) == 100:
                break
    return regions
