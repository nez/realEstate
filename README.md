# Introduction
This repo is for crawl data from some suumo pages, and save it into `mongodb` for future use.
![Screenshot 2024-03-20 135657](https://github.com/Takusei/realEstate/assets/45616321/84d652c7-fbdd-4a07-b513-50af99debd5e)


# Setup
Copy the env templates and fill in real credentials. Both files are gitignored.
```
cp .env.example .env
cp scraper/.env.example scraper/.env
# Edit both. Set:
#   .env         — MONGO_INITDB_ROOT_PASSWORD, MONGO_APP_PASSWORD, MONGO_URI_APP, MONGO_URI_ROOT
#   scraper/.env — MONGO_URI (point at the app user, not root)
```

The mongo image's first-boot init creates a `suumo_app` user (`readWrite` on `suumo` only) from `MONGO_APP_*`. The scraper connects as that user; only the nightly mongodump uses root.

# Deploy
## How to run this in docker?
```
docker compose down --volumes && docker compose up --build -d
```

## How to run this on k3s?
```
# Build the image
docker build -f ./scraper/docker/Dockerfile -t suumo-scraper:latest ./scraper/. --no-cache

# Import into k3s' containerd (replace `minikube image load` if migrating from minikube)
docker save suumo-scraper:latest | sudo k3s ctr images import -

# Create the namespace and secret (see secret.example.yaml for the shape).
# Two URIs: scraper uses the app one, backup uses root.
kubectl create namespace realestate
kubectl create secret generic mongodb-creds -n realestate \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=admin \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD='<rotated-root-password>' \
  --from-literal=MONGO_INITDB_DATABASE=suumo \
  --from-literal=MONGO_APP_USERNAME=suumo_app \
  --from-literal=MONGO_APP_PASSWORD='<app-password>' \
  --from-literal=MONGO_URI_ROOT='mongodb://admin:<rotated-root-password>@mongodb.realestate.svc.cluster.local:27017/?authSource=admin' \
  --from-literal=MONGO_URI_APP='mongodb://suumo_app:<app-password>@mongodb.realestate.svc.cluster.local:27017/?authSource=suumo'

# Apply the manifest (Service, ConfigMap, PVCs, Deployment, scraper CronJobs,
# backup CronJob)
kubectl apply -f deployment.yaml

# Verify
kubectl -n realestate get all

# Access mongodb from your host
kubectl -n realestate port-forward deployments/mongodb 27017:27017
```

### Upgrading an existing deployment to the least-privilege user
The init script only runs on a virgin `/data/db`. For existing data, create
the app user manually once:
```
kubectl -n realestate exec -it deployments/mongodb -- mongosh \
  -u admin -p '<root-password>' --authenticationDatabase admin \
  --eval "db.getSiblingDB('suumo').createUser({
    user: 'suumo_app',
    pwd: '<app-password>',
    roles: [{role: 'readWrite', db: 'suumo'}]
  })"
```

### Restoring from a backup
The nightly CronJob writes `suumo-YYYYMMDD-HHMMSS.archive.gz` to the
`mongodb-backup` PVC. To restore:
```
kubectl -n realestate run mongo-restore --rm -it --restart=Never \
  --image=mongo:7.0 \
  --overrides='{"spec":{"volumes":[{"name":"backup","persistentVolumeClaim":{"claimName":"mongodb-backup"}}],"containers":[{"name":"mongo-restore","image":"mongo:7.0","stdin":true,"tty":true,"volumeMounts":[{"name":"backup","mountPath":"/backup"}],"command":["bash"]}]}}'
# Inside the pod:
mongorestore --uri="<MONGO_URI_ROOT>" --gzip --archive=/backup/suumo-<TS>.archive.gz --drop
```

## Tips
```
# Remove all build volumes and containers
docker rm -vf $(docker ps -aq)

# Remove all built images
docker rmi -f $(docker images -aq)
```

# Access
Connect to mongodb with the URI from your `.env` (`mongodb://<user>:<password>@localhost:27017/suumo?authSource=admin`).

## Querying for cheap listings
After at least one detail crawl has succeeded, query from the `scraper/` directory:

```
# Cheapest 20 by ¥/m² (default sort)
bun run query listings

# Sub-50M¥ in Chiyoda, ≥40m², 20 cheapest by ¥/m²
bun run query listings --max-sale 50000000 --address 千代田 --min-size 40

# Recent price drops in the last 7 days
bun run query changes --kind price_drop --since 7d

# JSON output for piping into jq/duckdb/whatever
bun run query listings --max-sale 50000000 --format json | jq '.[].url'
```

The CLI reads `MONGO_URI` from `scraper/.env`. For local development this is usually `localhost`; in docker / k3s it's `mongodb` / `mongodb.realestate.svc.cluster.local`.

## Mongo URI host by environment
```
local: localhost
docker: host.docker.internal or mongodb (using the service name in docker compose)
k3s:    mongodb.realestate.svc.cluster.local
```
