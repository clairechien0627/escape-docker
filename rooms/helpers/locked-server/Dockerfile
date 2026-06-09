FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y \
    openssh-server python3 curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash player && \
    mkdir -p /home/player/.ssh && \
    chmod 700 /home/player/.ssh && \
    chown player:player /home/player/.ssh

# SSH 只允許公鑰認證
RUN mkdir /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config

COPY setup.sh /setup.sh
COPY flag_server.py /flag_server.py
RUN chmod +x /setup.sh && /setup.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
