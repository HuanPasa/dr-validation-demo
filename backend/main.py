from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import os


app = FastAPI(
    title="DR Validation Backend",
    version="1.0"
)


# supaya nanti FE React bisa akses
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# DATABASE CONNECTION
# =========================

def db_connect():

    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )


# =========================
# HEALTH CHECK
# =========================

@app.get("/")
def home():

    return {
        "application": "DR Validation Backend",
        "status": "running"
    }



@app.get("/health")
def health():

    try:

        conn = db_connect()
        conn.close()

        return {
            "status": "UP",
            "database": "CONNECTED"
        }

    except Exception as e:

        return {
            "status": "DOWN",
            "database": str(e)
        }



# =========================
# READ CUSTOMER
# =========================

@app.get("/customer")
def get_customer():

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT id,name,email,company,created_at
        FROM customer
        ORDER BY id
        """
    )

    rows = cur.fetchall()

    cur.close()
    conn.close()


    return rows



# =========================
# CREATE CUSTOMER
# =========================

@app.post("/customer")
def create_customer(
    name:str,
    email:str,
    company:str
):

    conn = db_connect()
    cur = conn.cursor()


    cur.execute(
        """
        INSERT INTO customer
        (name,email,company)
        VALUES(%s,%s,%s)
        RETURNING id
        """,
        (
            name,
            email,
            company
        )
    )


    customer_id = cur.fetchone()[0]


    conn.commit()

    cur.close()
    conn.close()


    return {

        "status":"created",
        "id":customer_id

    }



# =========================
# UPDATE CUSTOMER
# =========================

@app.put("/customer/{customer_id}")
def update_customer(
    customer_id:int,
    name:str,
    email:str,
    company:str
):

    conn = db_connect()
    cur = conn.cursor()


    cur.execute(
        """
        UPDATE customer
        SET
        name=%s,
        email=%s,
        company=%s
        WHERE id=%s
        """,
        (
            name,
            email,
            company,
            customer_id
        )
    )


    conn.commit()

    cur.close()
    conn.close()


    return {

        "status":"updated",
        "id":customer_id

    }



# =========================
# DELETE CUSTOMER
# =========================

@app.delete("/customer/{customer_id}")
def delete_customer(customer_id:int):

    conn = db_connect()
    cur = conn.cursor()


    cur.execute(
        """
        DELETE FROM customer
        WHERE id=%s
        """,
        (customer_id,)
    )


    conn.commit()

    cur.close()
    conn.close()


    return {

        "status":"deleted",
        "id":customer_id

    }



# =========================
# FILE UPLOAD
# =========================

@app.post("/upload")
def upload_file(
    file: UploadFile = File(...)
):

    # sementara hanya validasi upload
    # nanti diganti boto3 -> Ceph RGW

    return {

        "filename":file.filename,
        "status":"received"

    }