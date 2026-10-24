# Serveur NTP de la maquette : chrony. Sans accès à Internet (zone
# serveurs isolée), il sert l'heure de sa propre horloge (« local stratum »).
# En vrai : synchronisé sur des serveurs de référence (pool NTP, GPS).
FROM alpine:3.20
RUN apk add --no-cache chrony iproute2
COPY chrony.conf /etc/chrony/chrony.conf
# -d : reste au premier plan ; -x : ne touche pas à l'horloge de la machine
# (un conteneur n'en a pas le droit).
# Le fichier de PID est effacé : après un redémarrage du conteneur, celui
# de la fois précédente ferait croire à chrony qu'il tourne déjà.
CMD ["sh", "-c", "ip route del default; ip route replace 10.10.0.0/16 via 10.10.20.254 && rm -f /var/run/chrony/chronyd.pid && exec chronyd -d -x -f /etc/chrony/chrony.conf"]
