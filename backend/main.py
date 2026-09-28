from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import psycopg2
import os
import uuid

from s3_client import (
    upload_to_s3,
    object_exists,
    check_bucket,
    delete_from_s3
)


app = FastAPI(
    title="DR Validation Backend",
    version="1.2"
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DATABASE CONNECTION
# =========================================================

def db_connect():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )


# =========================================================
# HOME
# =========================================================

@app.get("/")
def home():
    return {
        "application": "DR Validation Backend",
        "version": "1.2",
        "status": "running"
    }


# =========================================================
# HEALTH CHECK
# =========================================================

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

    # Ceph RGW / S3
    try:
        check_bucket()

        result["s3"] = "CONNECTED"

    except Exception as e:
        result["s3"] = f"FAILED: {str(e)}"

    return result


# =========================================================
# CUSTOMER - READ
# =========================================================

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


# =========================================================
# CUSTOMER - CREATE
# =========================================================

@app.post("/customer")
def create_customer(
    name: str,
    email: str,
    company: str
):

    conn = db_connect()
    cur = conn.cursor()

    try:

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

        return {
            "status": "created",
            "id": customer_id
        }

    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to create customer: {str(e)}"
        )

    finally:

        cur.close()
        conn.close()


# =========================================================
# CUSTOMER - UPDATE
# =========================================================

@app.put("/customer/{customer_id}")
def update_customer(
    customer_id: int,
    name: str,
    email: str,
    company: str
):

    conn = db_connect()
    cur = conn.cursor()

    try:

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

        if cur.rowcount == 0:

            conn.rollback()

            raise HTTPException(
                status_code=404,
                detail="Customer not found"
            )

        conn.commit()

        return {
            "status": "updated",
            "id": customer_id
        }

    except HTTPException:
        raise

    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to update customer: {str(e)}"
        )

    finally:

        cur.close()
        conn.close()


# =========================================================
# CUSTOMER - DELETE
# =========================================================

@app.delete("/customer/{customer_id}")
def delete_customer(
    customer_id: int
):

    conn = db_connect()
    cur = conn.cursor()

    try:

        cur.execute(
            """
            DELETE FROM customer
            WHERE id = %s
            """,
            (
                customer_id,
            )
        )

        if cur.rowcount == 0:

            conn.rollback()

            raise HTTPException(
                status_code=404,
                detail="Customer not found"
            )

        conn.commit()

        return {
            "status": "deleted",
            "id": customer_id
        }

    except HTTPException:
        raise

    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete customer: {str(e)}"
        )

    finally:

        cur.close()
        conn.close()


# =========================================================
# DOCUMENT - UPLOAD TO S3
# =========================================================

@app.post("/upload")
def upload_document(
    file: UploadFile = File(...)
):

    # UUID supaya file dengan nama sama tidak overwrite
    object_key = (
        f"{uuid.uuid4()}-{file.filename}"
    )

    try:

        # Upload object ke Ceph RGW
        result = upload_to_s3(
            file.file,
            object_key
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload file to S3: {str(e)}"
        )


    # Simpan metadata ke PostgreSQL
    conn = db_connect()
    cur = conn.cursor()

    try:

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

        return {
            "status": "uploaded",
            "id": document_id,
            "filename": file.filename,
            "bucket": result["bucket"],
            "object_key": result["object"]
        }

    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"File uploaded to S3 but metadata insert failed: {str(e)}"
        )

    finally:

        cur.close()
        conn.close()


# =========================================================
# DOCUMENT - LIST METADATA FROM DATABASE
# =========================================================

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


# =========================================================
# DOCUMENT - VERIFY DATABASE VS S3
# =========================================================

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

            if exists:
                s3_status = "AVAILABLE"
                consistency = "CONSISTENT"

            else:
                s3_status = "MISSING"
                consistency = "INCONSISTENT"

        except Exception as e:

            exists = False
            s3_status = f"ERROR: {str(e)}"
            consistency = "INCONSISTENT"


        results.append(
            {
                "id": document_id,
                "filename": filename,
                "bucket": bucket,
                "object_key": object_key,
                "uploaded_at": uploaded_at,

                "database_record": True,
                "s3_object": exists,

                "s3_status": s3_status,
                "status": consistency
            }
        )

    return results


# =========================================================
# DOCUMENT - DELETE FROM S3 + DATABASE
# =========================================================

@app.delete("/documents/{document_id}")
def delete_document(
    document_id: int
):

    conn = db_connect()
    cur = conn.cursor()

    try:

        # Ambil metadata dari PostgreSQL
        cur.execute(
            """
            SELECT
                filename,
                bucket,
                object_key
            FROM documents
            WHERE id = %s
            """,
            (
                document_id,
            )
        )

        row = cur.fetchone()

        if not row:

            raise HTTPException(
                status_code=404,
                detail="Document not found"
            )


        filename = row[0]
        bucket = row[1]
        object_key = row[2]


        # Hapus object asli dari Ceph RGW
        try:

            delete_from_s3(
                bucket,
                object_key
            )

        except Exception as e:

            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete object from S3: {str(e)}"
            )


        # Setelah S3 berhasil, hapus metadata dari DB
        cur.execute(
            """
            DELETE FROM documents
            WHERE id = %s
            """,
            (
                document_id,
            )
        )

        conn.commit()


        return {
            "status": "deleted",
            "id": document_id,
            "filename": filename,
            "bucket": bucket,
            "object_key": object_key
        }


    except HTTPException:

        conn.rollback()
        raise


    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete document: {str(e)}"
        )


    finally:

        cur.close()
        conn.close()