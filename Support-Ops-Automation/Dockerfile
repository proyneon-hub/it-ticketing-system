FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt pyproject.toml ./
COPY src ./src
COPY docs ./docs
COPY reports ./reports

RUN pip install --no-cache-dir -r requirements.txt

CMD ["python", "-m", "support_ops.report_generator"]
