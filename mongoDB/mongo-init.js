db.createUser(
    {
        user: "user",
        pwd: "REDACTED",
        roles: [
            {
                role: "readWrite",
                db: "suumo"
            }
        ]
    }
);

db.createCollection('suumo');