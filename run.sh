#!/bin/bash

set -e
BASEDIR=$(dirname "$0")
cd $BASEDIR
clear

# tsc -v
# tsc --watch

docker compose down
docker compose up --build

# List containers
# docker compose ps
# docker ps -a

# View logs
# docker compose logs -f
# docker compose logs -f <service_name>

# Enter running container shell
# docker compose exec <service_name> /bin/bash
# docker compose exec <service_name> /bin/sh
# docker compose run --rm --service-ports <service_name> /bin/bash