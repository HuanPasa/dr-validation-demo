from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

import psycopg2
import os
import uuid

from s3_client import (
    upload_to_s3,
    object_exists,
    check_bucket
)


app = FastAPI(
    title="DR Validation Backend",
    version="1.1"
)


# =========================
# CORS
# =========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# DATABASE
# =========================

def db_connect():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )


# =========================
# HOME
# =========================

@app.get("/")
def home():
    return {
        "application": "DR Validation Backend",
        "version": "1.1",
        "status": "running"
    }


# =========================
# HEALTH CHECK
# =========================

@app.get("/health")
def health():

    result = {
        "application": "DR Validation Backend",
        "database": "UNKNOWN",
        "s3": "UNKNOWN"
    }

    # PostgreSQL
    try:
        conn = db_connect()
        conn.close()

        result["database"] = "CONNECTED"

    except Exception as e:
        result["database"] = f"FAILED: {str(e)}"

    # Ceph RGW bucket
    try:
        check_bucket()

        result["s3"] = "CONNECTED"

    except Exception as e:
        result["s3"] = f"FAILED: {str(e)}"

    return result


# =========================
# READ CUSTOMER
# =========================

@app.get("/customer")
def get_customer():

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            id,
            name,
            email,
            company,
            created_at
        FROM customer
        ORDER BY id
        """
    )

    rows = cur.fetchall()

    cur.close()
    conn.close()

    return [
        {
            "id": row[0],
            "name": row[1],
            "email": row[2],
            "company": row[3],
            "created_at": row[4]
        }
        for row in rows
    ]


# =========================
# CREATE CUSTOMER
# =========================

@app.post("/customer")
def create_customer(
    name: str,
    email: str,
    company: str
):

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO customer
        (
            name,
            email,
            company
        )
        VALUES
        (
            %s,
            %s,
            %s
        )
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
        "status": "created",
        "id": customer_id
    }


# =========================
# UPDATE CUSTOMER
# =========================

@app.put("/customer/{customer_id}")
def update_customer(
    customer_id: int,
    name: str,
    email: str,
    company: str
):

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE customer
        SET
            name = %s,
            email = %s,
            company = %s
        WHERE id = %s
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
        "status": "updated",
        "id": customer_id
    }


# =========================
# DELETE CUSTOMER
# =========================

@app.delete("/customer/{customer_id}")
def delete_customer(
    customer_id: int
):

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        DELETE FROM customer
        WHERE id = %s
        """,
        (
            customer_id,
        )
    )

    conn.commit()

    cur.close()
    conn.close()

    return {
        "status": "deleted",
        "id": customer_id
    }


# =========================
# UPLOAD FILE TO S3
# =========================

@app.post("/upload")
def upload_document(
    file: UploadFile = File(...)
):

    # supaya nama file yang sama tidak overwrite
    object_key = (
        str(uuid.uuid4())
        + "-"
        + file.filename
    )

    result = upload_to_s3(
        file.file,
        object_key
    )

    # simpan metadata ke PostgreSQL

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO documents
        (
            filename,
            bucket,
            object_key
        )
        VALUES
        (
            %s,
            %s,
            %s
        )
        RETURNING id
        """,
        (
            file.filename,
            result["bucket"],
            result["object"]
        )
    )

    document_id = cur.fetchone()[0]

    conn.commit()

    cur.close()
    conn.close()

    return {
        "status": "uploaded",
        "id": document_id,
        "filename": file.filename,
        "bucket": result["bucket"],
        "object_key": result["object"]
    }


# =========================
# LIST DOCUMENT METADATA
# =========================

@app.get("/documents")
def get_documents():

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            id,
            filename,
            bucket,
            object_key,
            uploaded_at
        FROM documents
        ORDER BY id DESC
        """
    )

    rows = cur.fetchall()

    cur.close()
    conn.close()

    return [
        {
            "id": row[0],
            "filename": row[1],
            "bucket": row[2],
            "object_key": row[3],
            "uploaded_at": row[4]
        }
        for row in rows
    ]


# =========================
# VERIFY DATABASE + S3
# =========================

@app.get("/documents/verify")
def verify_documents():

    conn = db_connect()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            id,
            filename,
            bucket,
            object_key,
            uploaded_at
        FROM documents
        ORDER BY id DESC
        """
    )

    rows = cur.fetchall()

    cur.close()
    conn.close()

    results = []

    for row in rows:

        document_id = row[0]
        filename = row[1]
        bucket = row[2]
        object_key = row[3]
        uploaded_at = row[4]

        try:

            exists = object_exists(
                bucket,
                object_key
            )

            s3_status = (
                "AVAILABLE"
                if exists
                else "MISSING"
            )

        except Exception as e:

            exists = False
            s3_status = f"ERROR: {str(e)}"

        results.append(
            {
                "id": document_id,
                "filename": filename,
                "bucket": bucket,
                "object_key": object_key,
                "uploaded_at": uploaded_at,

                "database_record": True,
                "s3_object": exists,

                "status": (
                    "CONSISTENT"
                    if exists
                    else "INCONSISTENT"
                ),

                "s3_status": s3_status
            }
        )

    return results