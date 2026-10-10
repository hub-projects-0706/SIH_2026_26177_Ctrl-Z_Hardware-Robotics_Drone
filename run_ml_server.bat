@echo off
echo ==============================================================================
echo       A.S.A.R.D - FastAPI Real-Time RT-DETR-L Machine Learning Server         
echo ==============================================================================
cd /d "%~dp0"
echo Starting FastAPI ML Inference Server on port 8000...
".\.venv\Scripts\python.exe" -m uvicorn ml_server:app --host 0.0.0.0 --port 8000
pause
