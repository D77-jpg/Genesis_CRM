"""Generate the product price import template used by the product page."""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILE = ROOT / "web" / "public" / "templates" / "product-price-import-template.xlsx"
DOC_FILE = ROOT / "docs" / "templates" / "产品价格导入模板.xlsx"

HEADER_FILL = PatternFill("solid", fgColor="6D4AFF")
HEADER_FONT = Font(color="FFFFFF", bold=True)
TITLE_FONT = Font(bold=True, size=14, color="2B2140")
BODY_FONT = Font(size=11, color="3B3550")
MUTED_FONT = Font(size=10, color="6B647B")
THIN = Side(style="thin", color="DDD8EA")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(vertical="top", wrap_text=True)


def style_header(sheet, widths):
    for column, width in widths.items():
        sheet.column_dimensions[column].width = width
    for cell in sheet[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
    sheet.row_dimensions[1].height = 28
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions


def add_rows(sheet, rows):
    for row in rows:
        sheet.append(row)
    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.font = BODY_FONT
            cell.alignment = WRAP
            cell.border = BORDER


def build():
    workbook = Workbook()
    product_sheet = workbook.active
    product_sheet.title = "产品"
    product_sheet.append(["SKU*", "产品名称*", "分类", "状态", "MOQ", "交期", "说明", "备注"])
    add_rows(product_sheet, [
        ["GB-POUCH-01", "Jewelry Pouch / 珠宝收纳袋", "首饰包装", "启用", "100 pcs", "25–30 days", "棉帆布，可定制 logo", ""],
        ["GB-TOTE-02", "Canvas Tote / 帆布托特包", "购物袋", "启用", "200 pcs", "20–25 days", "", ""],
    ])
    style_header(product_sheet, {"A": 16, "B": 28, "C": 16, "D": 12, "E": 12, "F": 14, "G": 30, "H": 18})
    status_validation = DataValidation(type="list", formula1='"启用,已归档"', allow_blank=True)
    product_sheet.add_data_validation(status_validation)
    status_validation.add("D2:D200")

    spec_sheet = workbook.create_sheet("规格")
    spec_sheet.append(["SKU*", "规格编码*", "规格名称*", "规格值*", "单位"])
    add_rows(spec_sheet, [
        ["GB-POUCH-01", "MAT", "材质", "棉帆布", ""],
        ["GB-POUCH-01", "SIZE", "尺寸", "8 × 10", "cm"],
        ["GB-TOTE-02", "MAT", "材质", "12oz 帆布", ""],
        ["GB-TOTE-02", "SIZE", "尺寸", "35 × 40", "cm"],
    ])
    style_header(spec_sheet, {"A": 16, "B": 14, "C": 14, "D": 26, "E": 10})

    tier_sheet = workbook.create_sheet("阶梯价")
    tier_sheet.append(["SKU*", "起订数量*", "最高数量", "单价*", "币种", "该档MOQ", "该档交期"])
    add_rows(tier_sheet, [
        ["GB-POUCH-01", 100, 499, 1.20, "USD", "100 pcs", "25–30 days"],
        ["GB-POUCH-01", 500, None, 0.98, "USD", "500 pcs", "30–35 days"],
        ["GB-TOTE-02", 200, 999, 2.10, "USD", "200 pcs", "20–25 days"],
        ["GB-TOTE-02", 1000, None, 1.85, "USD", "1000 pcs", "25–30 days"],
    ])
    style_header(tier_sheet, {"A": 16, "B": 14, "C": 14, "D": 12, "E": 10, "F": 14, "G": 16})
    currency_validation = DataValidation(type="list", formula1='"USD,EUR,GBP,CNY"', allow_blank=False)
    tier_sheet.add_data_validation(currency_validation)
    currency_validation.add("E2:E500")
    for row in tier_sheet.iter_rows(min_row=2, min_col=4, max_col=4):
        for cell in row:
            cell.number_format = "0.00"
    tier_sheet.column_dimensions["D"].width = 12

    guide = workbook.create_sheet("填写说明")
    guide["A1"] = "产品价格导入模板"
    guide["A1"].font = TITLE_FONT
    guide.merge_cells("A1:C1")
    guide["A2"] = "每个项目单独导入；导入时只会写入当前项目。SKU 在项目内唯一，重复 SKU 会覆盖同项目已有产品。"
    guide["A2"].font = MUTED_FONT
    guide.merge_cells("A2:C2")
    guide["A4"] = "工作表"
    guide["B4"] = "怎么填"
    guide["C4"] = "示例"
    for cell in guide[4]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
    rows = [
        ("产品", "一行一个产品；SKU 和产品名称必填。状态只能填「启用」或「已归档」。", "GB-POUCH-01 / Jewelry Pouch"),
        ("规格", "同一个 SKU 可以有多行；规格编码不能重复。没有规格可以留空或删除示例行。", "MAT / 材质 / 棉帆布"),
        ("阶梯价", "同一个 SKU 可以有多行；起订数量按从小到大填写。上一档填写最高数量，最后一档留空表示无上限。单价只填数字，币种选 USD / EUR / GBP / CNY。", "100–499 / 1.20 / USD"),
    ]
    for index, values in enumerate(rows, start=5):
        for column, value in zip("ABC", values):
            guide[f"{column}{index}"] = value
            guide[f"{column}{index}"].font = BODY_FONT
            guide[f"{column}{index}"].alignment = WRAP
            guide[f"{column}{index}"].border = BORDER
    guide.column_dimensions["A"].width = 16
    guide.column_dimensions["B"].width = 76
    guide.column_dimensions["C"].width = 38
    guide.row_dimensions[2].height = 32
    for row in range(5, 8):
        guide.row_dimensions[row].height = 52
    guide["A9"] = "提示"
    guide["A9"].font = Font(bold=True, color="2B2140")
    guide["A10"] = "下载模板后，只需保留/修改需要导入的行；示例行可以删除。不要把「产品」「规格」「阶梯价」三个工作表名改掉。"
    guide["A10"].font = MUTED_FONT
    guide.merge_cells("A10:C10")
    guide["A10"].alignment = WRAP
    guide.row_dimensions[10].height = 34

    PUBLIC_FILE.parent.mkdir(parents=True, exist_ok=True)
    DOC_FILE.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(PUBLIC_FILE)
    workbook.save(DOC_FILE)
    print(PUBLIC_FILE)
    print(DOC_FILE)


if __name__ == "__main__":
    build()
