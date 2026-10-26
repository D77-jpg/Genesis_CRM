"""S1 local-only parser. JSON-lines protocol; never interprets document instructions.
No downloads, shell commands, external relationships or model services.
"""
import csv
import ctypes
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import sys
import time
import zipfile
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8", errors="strict")
VERSION = "genesis-parser-s1.1"
LIMITS = {"bytes": 15 * 1024**2, "expanded": 64 * 1024**2, "entry": 16 * 1024**2,
          "entries": 1500, "pages": 50, "sheets": 12, "rows": 10000, "columns": 80,
          "characters": 1000000, "chunks": 1200, "pixels": 16000000, "tokens": 128}


class ParseFailure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def fail(code, message):
    raise ParseFailure(code, message)


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def restrict():
    # Limits are installed before loading native PDF/OCR libraries. Windows Job
    # Objects enforce process memory and CPU, Linux uses kernel rlimits.
    if os.name == "nt":
        from ctypes import wintypes as W
        class Basic(ctypes.Structure):
            _fields_ = [("perProcess", ctypes.c_longlong), ("perJob", ctypes.c_longlong),
                        ("flags", W.DWORD), ("minWork", ctypes.c_size_t), ("maxWork", ctypes.c_size_t),
                        ("active", W.DWORD), ("affinity", ctypes.c_size_t), ("priority", W.DWORD), ("scheduling", W.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ["readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes"]]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcess", ctypes.c_size_t), ("peakJob", ctypes.c_size_t)]
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateJobObjectW.restype = W.HANDLE
        k.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]
        k.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        k.GetCurrentProcess.restype = W.HANDLE
        job = k.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x100 | 0x2 | 0x8  # process memory, CPU time, active-process limit
        limits.basic.perProcess = 120 * 10000000
        limits.basic.active = 1
        limits.processMemory = 1536 * 1024**2
        if not job or not k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not k.AssignProcessToJobObject(job, k.GetCurrentProcess()):
            fail("resource_limits", "无法建立本地解析资源限制，请检查运行环境")
        # Keep the handle open until process exit.
        globals()["_job"] = job
    else:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    def blocked(*_args, **_kwargs):
        raise PermissionError("Parser network access is disabled")
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked
    def audit(event, _args):
        if event in {"subprocess.Popen", "os.system", "os.exec", "socket.connect", "socket.bind"}:
            blocked()
    sys.addaudithook(audit)


def xml(data):
    # ElementTree does not fetch external entities; reject all DTD/entity input too.
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)", data, re.I):
        fail("unsafe_xml", "文档含 DTD 或实体声明，已拒绝")
    return ET.fromstring(data)


def archive(raw, kind):
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        infos = z.infolist()
        if len(infos) > LIMITS["entries"] or sum(i.file_size for i in infos) > LIMITS["expanded"]:
            fail("archive_limit", "文档解压后过大或内部文件过多，请拆分资料")
        names = set()
        for info in infos:
            name = info.filename
            if name in names or "\\" in name or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
                fail("unsafe_archive", "文档内部路径异常或重复")
            names.add(name)
            if info.flag_bits & 1 or info.file_size > LIMITS["entry"] or info.file_size / max(1, info.compress_size) > 200:
                fail("archive_limit", "文档包含加密或异常压缩内容")
            low = name.lower()
            if any(p in low for p in ("vbaproject", "activex", "embeddings/", "externallinks/")) or low.endswith((".exe", ".js", ".vbs")):
                fail("active_content", "含宏、嵌入对象或外部工作簿的资料不支持，请导出静态文档")
            if low.endswith((".xml", ".rels")):
                root = xml(z.read(info))
                if low.endswith(".rels") and any(e.get("TargetMode", "").lower() == "external" for e in root):
                    fail("external_links", "含外部链接的 Office 文档需先移除链接或导出静态 PDF")
        needed = "word/document.xml" if kind == "docx" else "xl/workbook.xml"
        if needed not in names or "[Content_Types].xml" not in names:
            fail("format_mismatch", "文件内容与扩展名不一致")
        return z
    except zipfile.BadZipFile:
        fail("invalid_archive", "Office 文件损坏，无法读取")


def plain(raw):
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        fail("encoding", "请将文本或 CSV 另存为 UTF-8 编码")
    if "\x00" in text or any(ord(c) < 9 for c in text):
        fail("binary_text", "文件不是可识别的 UTF-8 文本")
    return text


def text_blocks(text, markdown=False):
    blocks, headings = [], []
    matches = list(re.finditer(r"[^\n]+(?:\n(?!\s*\n|#{1,6}\s)[^\n]+)*", text))
    for m in matches:
        body = m.group().strip()
        heading = re.match(r"^(#{1,6})\s+(.+)$", body) if markdown else None
        if heading:
            level = len(heading[1])
            headings = headings[:level-1] + [heading[2]]
        blocks.append({"text": body, "headingPath": list(headings),
                       "location": {"kind": "text", "offsetUnit": "unicode_codepoints", "start": m.start(), "end": m.end()}})
    # Keep complete pipe tables (including footnotes) as atomic contexts; row
    # expansion happens below so each row repeats headers and associated notes.
    if markdown:
        definitions = {m[1]: m[0] for m in re.finditer(r"(?m)^\[\^([^\]]+)\]:[^\n]+", text)}
        for i, b in enumerate(blocks):
            attached = [definitions[key] for key in re.findall(r"\[\^([^\]]+)\](?!:)", b["text"]) if key in definitions]
            if "|" in b["text"] and i+1 < len(blocks) and re.match(r"^(?:[*†‡]|note\b|注|备注|说明)", blocks[i+1]["text"], re.I):
                attached.append(blocks[i+1]["text"])
            if attached:
                b["text"] += "\n" + "\n".join(attached)
                b.setdefault("footnotes", []).extend(attached)
        expanded = []
        table_number = 0
        for b in blocks:
            lines = b["text"].splitlines()
            if len(lines) > 1 and "|" in lines[0] and re.match(r"^[\s|:\-]+$", lines[1]):
                table_number += 1
                header_cells = [cell.strip() for cell in lines[0].strip().strip("|").split("|")]
                rows = [line for line in lines[2:] if "|" in line]
                notes = [line for line in lines[2:] if "|" not in line]
                for row_number, row in enumerate(rows, 1):
                    expanded.append({**b, "text": "\n".join([lines[0], lines[1], row, *notes]), "headers": [lines[0]], "footnotes": notes,
                                     "location": {**b["location"], "kind": "table", "table": table_number, "row": row_number, "line": row_number + 2},
                                     "table": {"headerText": lines[0], "rowText": row, "headers": header_cells,
                                               "row": [cell.strip() for cell in row.strip().strip("|").split("|")],
                                               "table": table_number, "rowNumber": row_number, "notes": notes, "mergedCells": []}})
            else:
                expanded.append(b)
        return expanded
    return blocks


def word_blocks(raw):
    z = archive(raw, "docx")
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    w = "{" + ns["w"] + "}"
    root = xml(z.read("word/document.xml"))
    note_map = {}
    for part, tag in [("word/footnotes.xml", "footnote"), ("word/endnotes.xml", "endnote")]:
        if part in z.namelist():
            for note in xml(z.read(part)).findall("w:"+tag, ns):
                note_map[note.get(w+"id")] = "".join(note.itertext())
    blocks, headings = [], []
    table_number = 0
    warnings = []
    def content(e):
        return "".join(n.text or "" for n in e.iter(w+"t"))
    def notes(e):
        ids = [n.get(w+"id") for n in e.iter() if n.tag in [w+"footnoteReference", w+"endnoteReference"]]
        return [note_map[i] for i in ids if i in note_map]
    for index, el in enumerate(root.find("w:body", ns)):
        if el.tag == w+"p":
            text = content(el)
            style = el.find("w:pPr/w:pStyle", ns)
            m = re.search(r"heading\s*([1-6])", style.get(w+"val", ""), re.I) if style is not None else None
            if m:
                headings = headings[:int(m[1])-1]+[text]
            if text.strip():
                footnotes = notes(el)
                blocks.append({"text": "\n".join([text, *footnotes]), "headingPath": list(headings), "footnotes": footnotes,
                               "location": {"kind": "word", "paragraph": index+1}})
        elif el.tag == w+"tbl":
            table_number += 1
            rows = el.findall("w:tr", ns)
            if len(rows) > LIMITS["rows"]:
                fail("row_limit", "表格行数超过限制")
            # Expand Word's visual grid. Merged cells must not collapse the
            # column count or silently shift a price into the wrong column.
            grid, merged, vmerge_state, vmerge_start = [], [], {}, {}
            for row_number, row in enumerate(rows, 1):
                cells = []
                for tc in row.findall("w:tc", ns):
                    text = content(tc)
                    tc_pr = tc.find("w:tcPr", ns)
                    span = 1
                    vmerge = None
                    if tc_pr is not None:
                        span_el = tc_pr.find("w:gridSpan", ns)
                        if span_el is not None:
                            try: span = max(1, min(80, int(span_el.get(w+"val", "1"))))
                            except ValueError: span = 1
                        vm = tc_pr.find("w:vMerge", ns)
                        if vm is not None:
                            vmerge = vm.get(w+"val", "continue")
                    col = len(cells) + 1
                    if vmerge == "continue":
                        text = vmerge_state.get(col, text)
                    elif vmerge == "restart":
                        vmerge_state[col] = text
                        vmerge_start[col] = row_number
                        merged.append({"row":row_number,"col":col,"rowSpan":1,"colSpan":1,"value":text})
                    for offset in range(span):
                        cells.append(text)
                        if span > 1:
                            merged.append({"row":row_number,"col":col+offset,"rowSpan":1,"colSpan":span,"value":text})
                    if vmerge == "continue":
                        start = vmerge_start.get(col, row_number)
                        for item in merged:
                            if item["row"] == start and item["col"] == col and item["rowSpan"] == 1:
                                item["rowSpan"] = row_number - start + 1
                                break
                grid.append(cells)
            if any(len(row) > LIMITS["columns"] for row in grid):
                fail("column_limit", "表格列数超过限制")
            if not grid:
                continue
            header_rows, data_start, prefix = [grid[0]], 1, ""
            ncols = max(len(row) for row in grid)
            if len(grid) > 1:
                first = [cell for cell in grid[0] if cell]
                second = [cell for cell in grid[1] if cell]
                # A single merged title row is not the column header. Keep it in
                # every row's context, then use the following row as headers.
                full_title = any(m["row"] == 1 and m["colSpan"] >= ncols for m in merged)
                if first and full_title and len(second) > 1:
                    prefix = first[0]
                    header_rows, data_start = [grid[1]], 2
                elif len(first) < len(second) or (len(first) == len(second) and len(set(first)) < len(first)):
                    header_rows, data_start = [grid[0], grid[1]], 2
            header_cells = header_rows[-1]
            header = "\n".join(([prefix] if prefix else []) + [" | ".join(row) for row in header_rows])
            table_notes = notes(el)
            # Adjacent note paragraphs belong to every row in this table.
            siblings = list(root.find("w:body", ns))
            for following in siblings[index+1:index+5]:
                s = content(following)
                if re.match(r"^(?:[*†‡]|note\b|注|备注|说明)", s, re.I):
                    table_notes.append(s)
                else:
                    break
            for n, row in enumerate(grid[data_start:] or grid):
                blocks.append({"text": "\n".join([header, " | ".join(row), *table_notes]), "headingPath": list(headings),
                               "headers": header_cells, "footnotes": table_notes,
                               "table": {"headers":header_cells,"headerRows":header_rows,"rows":[row],"notes":table_notes,"mergedCells":merged},
                               "location": {"kind": "word", "table": table_number, "row": n+data_start+1, "rowSpan": 1, "mergedCells": merged}})
            if merged:
                warnings.append("Word 表格包含合并单元格，已按视觉网格展开；跨行/跨列条件请对照原文核对。")
    return blocks, warnings


def col_number(ref):
    value = 0
    for c in re.match(r"[A-Z]+", ref.upper())[0]:
        value = value*26+ord(c)-64
    return value


def _cell_coords(ref):
    m = re.match(r"([A-Z]+)(\d+)", (ref or "").upper())
    if not m:
        return None
    return int(m.group(2)), col_number(m.group(1))


def table_blocks(rows, name, merges=None):
    if not rows:
        return []
    header_i = next((i for i, row in enumerate(rows) if row["cells"]), None)
    if header_i is None:
        return []
    # Build a value map for merged ranges. Excel stores the value only in the
    # top-left cell; without this expansion a merged product/price cell looks
    # blank in the row that actually belongs to the second column.
    merge_values, merged_cells = {}, []
    for ref in merges or []:
        if ":" not in ref:
            continue
        a, b = _cell_coords(ref.split(":", 1)[0]), _cell_coords(ref.split(":", 1)[1])
        if not a or not b:
            continue
        r1, c1 = a; r2, c2 = b
        value = next((row["cells"][c1-1] for row in rows if _cell_coords(row["range"].split(":", 1)[0]) == (r1, 1) and len(row["cells"]) >= c1), "")
        merged_cells.append({"range": ref, "row": r1, "col": c1, "rowSpan": r2-r1+1, "colSpan": c2-c1+1, "value": value})
        for rr in range(r1, r2+1):
            for cc in range(c1, c2+1):
                merge_values[(rr, cc)] = value
    table_rows = []
    for row in rows:
        start = _cell_coords(row["range"].split(":", 1)[0]) or ((int(row["line"]) if row.get("line") else 0), 1)
        cells = list(row["cells"])
        width = max(len(cells), max((c for (_, c) in merge_values if c <= LIMITS["columns"]), default=0))
        while len(cells) < width:
            cells.append("")
        for idx in range(len(cells)):
            if not cells[idx] and (start[0], idx+1) in merge_values:
                cells[idx] = merge_values[(start[0], idx+1)]
        table_rows.append({**row, "cells": cells, "rowNumber": start[0]})
    header_i = next((i for i, row in enumerate(table_rows) if row["cells"]), None)
    if header_i is None:
        return []
    ncols = max(len(row["cells"]) for row in table_rows)
    header_rows, data_start, prefix = [table_rows[header_i]["cells"]], header_i+1, ""
    if data_start < len(table_rows):
        full_title = any(m["row"] == table_rows[header_i]["rowNumber"] and m["colSpan"] >= ncols for m in merged_cells)
        if full_title:
            prefix = next((cell for cell in header_rows[0] if cell), "")
            header_i += 1
            header_rows, data_start = [table_rows[header_i]["cells"]], header_i+1
        elif any(m["row"] == table_rows[header_i]["rowNumber"] and m["colSpan"] > 1 for m in merged_cells):
            header_rows.append(table_rows[header_i+1]["cells"])
            data_start = header_i+2
    header_cells = header_rows[-1]
    header_text = "\n".join(([prefix] if prefix else []) + [" | ".join(row) for row in header_rows])
    notes = [" | ".join(row["cells"]) for row in table_rows[data_start:] if row["cells"] and re.match(r"^(?:[*†‡]|note\b|注|备注|说明)", row["cells"][0], re.I)]
    blocks = []
    for row in table_rows[data_start:]:
        if not row["cells"] or " | ".join(row["cells"]) in notes:
            continue
        blocks.append({"text": "\n".join([header_text, " | ".join(row["cells"]), *notes]),
                       "headingPath": [name], "headers": header_cells, "footnotes": notes,
                       "table": {"headers":header_cells,"headerRows":header_rows,"rows":[row["cells"]],"notes":notes,"mergedCells":merged_cells,"headerRange":table_rows[header_i]["range"],"rowRange":row["range"]},
                       "location": {"kind": "sheet", "sheet": name, "table": name, "row": row.get("rowNumber"), "range": row["range"],
                                    "headerRange": table_rows[header_i]["range"], "mergedCells": merges or []}})
    if not blocks:
        blocks.append({"text": header_text, "headingPath": [name], "headers": header_cells,
                       "table": {"headers":header_cells,"headerRows":header_rows,"rows":[],"notes":notes,"mergedCells":merged_cells,"headerRange":table_rows[header_i]["range"]},
                       "location": {"kind": "sheet", "sheet": name, "table": name, "row": table_rows[header_i].get("rowNumber"), "range": table_rows[header_i]["range"], "mergedCells": merges or []}})
    return blocks


def excel_blocks(raw):
    z = archive(raw, "xlsx")
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rels = {e.get("Id"): e.get("Target") for e in xml(z.read("xl/_rels/workbook.xml.rels"))}
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter("{"+ns["m"]+"}t")) for si in xml(z.read("xl/sharedStrings.xml"))]
    sheets = xml(z.read("xl/workbook.xml")).findall("m:sheets/m:sheet", ns)
    if len(sheets) > LIMITS["sheets"]:
        fail("sheet_limit", "最多支持 12 个工作表，请拆分工作簿")
    blocks, warnings = [], ["电子表格首个非空行为表头；多级表头、合并单元格及单位需在审核时核对。公式不计算，只保留表达式和已有缓存值。"]
    styles = []
    if "xl/styles.xml" in z.namelist():
        sr = xml(z.read("xl/styles.xml"))
        fmts = {"5":"$#,##0", "6":"$#,##0;[Red]", "7":"$#,##0.00", "8":"$#,##0.00;[Red]", "9":"0%", "10":"0.00%", "14":"date serial (Excel epoch)", "49":"text"}
        fmts.update({e.get("numFmtId"): e.get("formatCode") for e in sr.findall("m:numFmts/m:numFmt", ns)})
        styles = [fmts.get(e.get("numFmtId"), e.get("numFmtId")) for e in sr.findall("m:cellXfs/m:xf", ns)]
    for sheet in sheets:
        target = rels.get(sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"), "")
        path = target.lstrip("/") if target.startswith("/") else "xl/"+target
        if ".." in PurePosixPath(path).parts or path not in z.namelist():
            fail("invalid_sheet", "工作表引用无效")
        root = xml(z.read(path))
        rows = root.findall("m:sheetData/m:row", ns)
        if len(rows) > LIMITS["rows"]:
            fail("row_limit", "工作表超过 10000 行")
        grid = []
        for row in rows:
            cells = []
            for c in row.findall("m:c", ns):
                ref = c.get("r", "A1")
                col = col_number(ref)
                if col > LIMITS["columns"] or int(re.search(r"\d+", ref)[0]) > LIMITS["rows"]:
                    fail("cell_limit", "工作表单元格范围超过 10000 行 / 80 列")
                while len(cells) < col:
                    cells.append("")
                v = c.find("m:v", ns)
                value = v.text if v is not None else ""
                if c.get("t") == "s":
                    value = shared[int(value)]
                elif c.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in c.findall(".//m:t", ns))
                f = c.find("m:f", ns)
                if f is not None:
                    value = "[未计算公式: "+(f.text or "")+"] 缓存值: "+str(value or "未提供")
                if c.get("s") and int(c.get("s")) < len(styles):
                    value = str(value or "")+" [格式: "+str(styles[int(c.get("s"))])+"]"
                cells[col-1] = str(value or "")
            if any(cells):
                grid.append({"cells": cells, "range": "A"+row.get("r", "1")+":"+(row.findall("m:c", ns)[-1].get("r", "A1"))})
        merges = [e.get("ref") for e in root.findall("m:mergeCells/m:mergeCell", ns)]
        blocks.extend(table_blocks(grid, sheet.get("name", "Sheet"), merges))
    return blocks, warnings


def csv_blocks(raw):
    text = plain(raw)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    csv.field_size_limit(100000)
    rows = []
    reader = csv.reader(io.StringIO(text), dialect)
    for i, row in enumerate(reader):
        if i >= LIMITS["rows"] or len(row) > LIMITS["columns"]:
            fail("cell_limit", "CSV 超过 10000 行 / 80 列")
        if any(row):
            rows.append({"cells": row, "range": f"record:{i+1}; physical-end-line:{reader.line_num}", "line": i+1})
    return table_blocks(rows, "CSV"), ["CSV 首个非空行为表头；公式样式文字仅作原文，不执行。"]


_ocr = None
def ocr(image):
    global _ocr
    import numpy as np
    import onnxruntime as ort
    ort.disable_telemetry_events()
    from rapidocr_onnxruntime import RapidOCR
    if _ocr is None:
        _ocr = RapidOCR(intra_op_num_threads=4, inter_op_num_threads=1)
    result, _ = _ocr(np.asarray(image.convert("RGB")))
    return [{"text": str(r[1]), "confidence": float(r[2]), "bbox": r[0]} for r in (result or [])]


def image_blocks(raw, extension):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = LIMITS["pixels"]
    image = Image.open(io.BytesIO(raw))
    if image.format != ("PNG" if extension=="png" else "JPEG"):
        fail("format_mismatch", "图片内容与扩展名不一致")
    if image.width * image.height > LIMITS["pixels"] or getattr(image, "n_frames", 1) != 1:
        fail("image_limit", "图片超过 1600 万像素或为多帧图片")
    result = ocr(image)
    text = "\n".join(r["text"] for r in result)
    score = min((r["confidence"] for r in result), default=0)
    return [{"text": text, "headingPath": [], "location": {"kind": "image", "width": image.width, "height": image.height,
             "coordinateSystem": "top-left-pixels", "bbox": [0, 0, image.width, image.height], "ocrLines": result, "confidence": score},
             "reviewRequired": True}], ["OCR 结果必须对照原图核对；表格读取顺序与跨行条件未经结构识别，整页保留。"] + (["低置信 OCR，请手工核对数字、币种和条件。"] if score < .90 else [])


def pdf_blocks(raw):
    # Static PDFium build, no init_forms / JavaScript API. Reject common active
    # features too; opaque/encoded object detection is not an antivirus claim.
    if re.search(br"/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b", raw):
        fail("active_pdf", "含活动内容或附件的 PDF 不支持，请重新导出静态 PDF")
    import pypdfium2 as pdfium
    blocks, warnings = [], []
    with pdfium.PdfDocument(raw) as doc:
        if len(doc) > LIMITS["pages"]:
            fail("page_limit", "PDF 最多支持 50 页，请拆分文件")
        for i in range(len(doc)):
            emit({"type": "progress", "done": i, "total": len(doc), "stage": "读取 PDF 页面"})
            page = doc[i]
            w, h = page.get_size()
            tp = page.get_textpage()
            text = tp.get_text_bounded().strip()
            tp.close()
            loc = {"kind": "pdf", "page": i+1, "width": w, "height": h, "coordinateSystem": "bottom-left-points", "bbox": [0, 0, w, h]}
            # Preserve each page atomically: a line of a PDF table must not lose
            # another column or its footer. Oversized pages are blocked for index.
            if len(re.sub(r"\s", "", text)) < 12:
                scale = min(2, (LIMITS["pixels"] / max(w*h, 1))**.5)
                image = page.render(scale=scale).to_pil()
                data = ocr(image)
                text = "\n".join(r["text"] for r in data)
                loc.update({"ocr": True, "ocrLines": data, "ocrCoordinateSystem": "top-left-pixels", "ocrScale": scale,
                            "confidence": min((r["confidence"] for r in data), default=0)})
                warnings.append(f"第 {i+1} 页使用本地 OCR；需核对阅读顺序、表格及脚注。")
                if loc["confidence"] < .90:
                    warnings.append(f"第 {i+1} 页 OCR 置信度偏低，数字和条件需人工核对。")
            if not text:
                warnings.append(f"第 {i+1} 页未识别到正文。")
            else:
                blocks.append({"text": text, "headingPath": [f"第 {i+1} 页"], "location": loc, "reviewRequired": True})
            page.close()
    return blocks, warnings + ["PDF 整页保留上下文；不自动推断表格列关系、跨页表格或脚注归属。"]


def tokenizer():
    from tokenizers import Tokenizer
    assets = Path(os.environ.get("KNOWLEDGE_TOKENIZER_DIR", ""))
    lock = json.loads((Path(__file__).parent / "runtime-lock.json").read_text(encoding="utf-8"))
    model = assets / "tokenizer.json"
    if not model.is_file() or hashlib.sha256(model.read_bytes()).hexdigest() != lock["vocabularyDigest"]:
        fail("tokenizer_unavailable", "本地分词器未配置或校验失败，请联系管理员完成解析环境安装")
    tok = Tokenizer.from_file(str(model))
    tok.no_truncation()
    return tok


def parse(raw, ext):
    if not raw or len(raw) > LIMITS["bytes"]:
        fail("size_limit", "资料为空或超过 15MB")
    if ext in ("txt", "md", "markdown"):
        blocks, warnings = text_blocks(plain(raw), ext != "txt"), []
    elif ext in ("docx", "xlsx"):
        if not raw.startswith(b"PK\x03\x04"):
            fail("format_mismatch", "文件内容与扩展名不一致")
        blocks, warnings = word_blocks(raw) if ext == "docx" else excel_blocks(raw)
    elif ext == "csv":
        blocks, warnings = csv_blocks(raw)
    elif ext == "pdf" and raw.startswith(b"%PDF-"):
        blocks, warnings = pdf_blocks(raw)
    elif ext in ("png", "jpg", "jpeg") and (raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff")):
        blocks, warnings = image_blocks(raw, ext)
    else:
        fail("format_mismatch", "格式不支持或文件内容与扩展名不一致")
    if not blocks or not any(b["text"].strip() for b in blocks):
        fail("no_text", "没有识别到可用正文，请上传清晰扫描件或手动录入")
    if len(blocks) > LIMITS["chunks"] or sum(len(b["text"]) for b in blocks) > LIMITS["characters"]:
        fail("content_limit", "正文或片段过多，请拆分文档")
    tok = tokenizer()
    chunks = []
    for n, b in enumerate(blocks):
        if not b["text"].strip():
            continue
        context = " / ".join(b["headingPath"])+"\n"+b["text"]
        count = len(tok.encode(context).ids)
        oversized = count > LIMITS["tokens"]
        alerts = []
        if oversized:
            alerts.append("上下文超过 128 tokens；整段保留，禁止静默截断，需人工整理或后续长窗口分块。")
        if re.search(r"ignore.{0,40}instructions|忽略.{0,15}(规则|指令)|system\s*prompt|自动发送", b["text"], re.I):
            alerts.append("包含疑似指令文字，仅作资料，不执行。")
        content = b.pop("text")
        chunks.append({**b, "ordinal": n, "content": content, "contentHash": hashlib.sha256(content.encode()).hexdigest(),
                       "tokenCount": count, "indexEligible": not oversized and not b.get("reviewRequired", False),
                       "warnings": alerts, "language": "zh" if re.search(r"[\u4e00-\u9fff]", context) else "en",
                       "currencies": sorted(set(re.findall(r"\b(?:USD|EUR|GBP|CNY|RMB)\b|[$€£¥]", context))),
                       "units": sorted(set(re.findall(r"\b(?:pcs?|pieces|sets?|days|weeks|kg|cm|mm)\b|工作日|天|件|套", context, re.I)))})
    return {"chunks": chunks, "warnings": list(dict.fromkeys(warnings)),
            "state": "partial" if warnings or any(c["warnings"] for c in chunks) else "succeeded"}


def main():
    started = time.monotonic()
    restrict()
    request = json.loads(sys.stdin.buffer.readline(16384))
    raw = Path(request["path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != request["sha256"]:
        fail("hash_mismatch", "原文校验失败，任务已停止")
    emit({"type": "progress", "stage": "校验与解析", "done": 0, "total": 1})
    packages = ["pypdfium2", "rapidocr-onnxruntime", "onnxruntime", "tokenizers", "pillow"]
    versions = {p: importlib.metadata.version(p) for p in packages}
    lock = json.loads((Path(__file__).parent / "runtime-lock.json").read_text(encoding="utf-8"))
    if versions != lock["packages"]:
        fail("runtime_version", "解析依赖版本与锁定版本不一致，请重建本地环境")
    from importlib.util import find_spec
    ocr_dir = Path(find_spec("rapidocr_onnxruntime").origin).parent / "models"
    for name, digest in lock["ocrWeights"].items():
        if hashlib.sha256((ocr_dir / name).read_bytes()).hexdigest() != digest:
            fail("ocr_integrity", "本地 OCR 模型校验失败")
    result = parse(raw, request["extension"])
    result.update({"parserVersion": VERSION, "packages": versions, "tokenizer": lock["vocabularyDigest"],
                   "ocrWeights": lock["ocrWeights"], "limits": LIMITS, "elapsedMs": round((time.monotonic()-started)*1000)})
    emit({"type": "result", **result})


if __name__ == "__main__":
    try:
        main()
    except ParseFailure as e:
        emit({"type": "error", "code": e.code, "message": e.message})
        sys.exit(1)
    except Exception:
        # No raw parser exception or document contents in user-visible errors.
        emit({"type": "error", "code": "parse_failed", "message": "文档损坏、内容无法识别或本地组件不可用，请核对格式后重试"})
        sys.exit(1)
