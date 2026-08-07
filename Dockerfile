FROM python:3.11-slim

WORKDIR /app
COPY nftoken_web/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY nftoken_web/ .

CMD ["python", "app.py"]
