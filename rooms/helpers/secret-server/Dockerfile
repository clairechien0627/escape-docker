FROM python:3.11-slim

WORKDIR /app
COPY app.py .

ENV FLAG_SEED=escape_docker_dev_seed
EXPOSE 80
CMD ["python3", "app.py"]
