from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response

from watermark import strip_watermark

app = FastAPI(title="pdf-watermark-cleaner")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/clean")
async def clean(file: UploadFile = File(...)):
    input_bytes = await file.read()
    output_bytes, stats = strip_watermark(input_bytes)

    return Response(
        content=output_bytes,
        media_type="application/pdf",
        headers={
            "X-Watermark-Texts": ",".join(stats["watermark_texts"]),
            "X-Removed-Operators": str(stats["removed_operators"]),
        },
    )
