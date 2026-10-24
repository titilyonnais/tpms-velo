# Pare-feu de la maquette : Alpine Linux + nftables (le filtre du noyau Linux).
FROM alpine:3.20
RUN apk add --no-cache nftables iproute2
COPY regles.nft /etc/nftables/regles.nft
# Charge les règles, montre les interfaces, puis attend (le filtrage est
# fait par le noyau : il n'y a pas de programme à faire tourner).
CMD ["sh", "-c", "nft -f /etc/nftables/regles.nft && echo 'Pare-feu : règles chargées' && ip -brief address && exec sleep infinity"]
