import asyncio
import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import dotenv

dotenv.load_dotenv(dotenv.find_dotenv())

from vram import vram, Lane
import db as db_layer
import nlp.extract as extract

PG_DSN = db_layer.build_dsn()

app = FastAPI(title="Raven Intelligence Engine")
sessions: dict[str, cv_session.CVSession] = {}
_subscribers: list[WebSocket] = []


async def broadcast(event: dict) -> None:
    for ws in list(_subscribers):
        try:
            await ws.send_json(event)
        except Exception:
            _subscribers.remove(ws)


@app.get("/health")
async def health():
    db_up = await db_layer.db_health()
    return {"status": "up", "db": "up" if db_up else "down", "models_loaded": [], **vram.status()}


@app.get("/db/health")
async def db_health():
    up = await db_layer.db_health()
    return {"db": "up" if up else "down"}


@app.get("/db/cases")
async def db_cases():
    rows = await db_layer.list_cases()
    return [dict(r) for r in rows]


@app.get("/vram/status")
async def vram_status():
    return vram.status()


@app.post("/ocr/extract")
async def ocr_extract(body: dict):
    return await extract.ocr_extract(body["file_path"], body.get("dpi", 300))


@app.post("/nlp/extract")
async def nlp_extract(body: dict):
    """Full extraction pipeline (architecture §5.2 / §6.1 step 7).

    Body: {file_path, mime, doc_id, dpi?, model?, mode?}. Returns a stable-id
    bound payload (entities/identifiers/locations/incident/relations/evidence).
    The Rust saga calls this during ingest; it is engine-agnostic (Ollama or
    the deterministic mock fallback).
    """
    await vram.acquire(Lane.NLP)
    try:
        return await extract.run_extraction(
            body["file_path"],
            body["mime"],
            body["doc_id"],
            dpi=body.get("dpi", 300),
            model=body.get("model"),
            mode=body.get("mode"),
        )
    finally:
        vram.release()


@app.post("/nlp/extract_entities")
async def nlp_entities(body: dict):
    await vram.acquire(Lane.NLP)
    try:
        return await extract.extract_entities(body["text"], body["doc_id"])
    finally:
        vram.release()


@app.post("/nlp/extract_relations")
async def nlp_relations(body: dict):
    return await extract.extract_relations(body["text"], body["doc_id"], body.get("entities", []))


@app.post("/nlp/summarize_edge")
async def nlp_summarize(body: dict):
    return await extract.summarize_edge(body.get("evidence", []))


@app.post("/cv/session/start")
async def cv_start(body: dict):
    from cv.session import CVSession
    code = body["camera_code"]
    s = CVSession(code, body["feed_uri"])
    sessions[code] = s
    return {"session_id": code, "stream_url": f"/cv/stream/{code}.mjpg",
            "ws_url": "/ws/events"}


@app.post("/cv/session/{sid}/lock_on")
async def cv_lock(sid: str, body: dict):
    await vram.acquire(Lane.CV)
    try:
        s = sessions[sid]
        return await s.lock_on(body["track_id"])
    finally:
        vram.release()


@app.post("/cv/session/{sid}/watch")
async def cv_watch(sid: str, body: dict):
    s = sessions[sid]
    s.watching = {c: body.get("window_start") for c in body.get("cameras", [])}
    return {"watch_id": sid}


@app.post("/cv/session/{sid}/stop")
async def cv_stop(sid: str):
    s = sessions[sid]
    return await s.stop()


@app.get("/cv/stream/{camera_code}.mjpg")
async def cv_stream(camera_code: str):
    from cv import stream as cv_stream
    s = sessions[camera_code]
    return StreamingResponse(
        cv_stream.mjpeg_stream(camera_code, s.feed_uri, broadcast),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.post("/analytics/routine")
async def analytics_routine(body: dict):
    from analytics import routine as routine_mod
    return await routine_mod.routine(PG_DSN, body["entity_id"], body.get("from"), body.get("to"))


@app.get("/tiles/{z}/{x}/{y}.pbf")
async def tiles(z: int, x: int, y: int):
    return StreamingResponse(iter([]), media_type="application/octet-stream")


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    _subscribers.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        _subscribers.remove(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8756, workers=1)
