# Journal central de la maquette : rsyslog reçoit les journaux UDP (port
# 514) de tout le réseau et les écrit dans /journaux/central.log
# (dossier entrepot/journaux/ sur le PC, lisible pendant la démonstration).
FROM alpine:3.20
RUN apk add --no-cache rsyslog iproute2
COPY rsyslog.conf /etc/rsyslog.conf
CMD ["sh", "-c", "ip route del default; ip route replace 10.10.0.0/16 via 10.10.20.254 && rm -f /var/run/rsyslogd.pid && exec rsyslogd -n -f /etc/rsyslog.conf"]
