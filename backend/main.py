from fastapi import (
    FastAPI,
    UploadFile,
    File,
    HTTPException
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import psycopg2
import os
import uuid

from urllib.parse import quote

from s3_client import (
    upload_to_s3,
    object_exists,
    check_bucket,
    delete_from_s3,
    download_from_s3,
    rename_s3_object
)


# =========================================================
# APPLICATION
# =========================================================

app = FastAPI(
    title="DR Validation Backend",
    version="1.3"
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
        "version": "1.3",
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

    # PostgreSQL health
    try:
        conn = db_connect()
        conn.close()

        result["database"] = "CONNECTED"

    except Exception as e:
        result["database"] = f"FAILED: {str(e)}"


    # Ceph RGW health
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

    try:

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

    finally:
        cur.close()
        conn.close()


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
        conn.rollback()
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
        conn.rollback()
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
# DOCUMENT - UPLOAD
# =========================================================

@app.post("/upload")
def upload_document(
    file: UploadFile = File(...)
):

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Filename is required"
        )


    # Generate unique S3 object key
    object_key = (
        f"{uuid.uuid4()}-{file.filename}"
    )


    # -----------------------------------------------------
    # Upload file to Ceph RGW
    # -----------------------------------------------------

    try:

        result = upload_to_s3(
            file.file,
            object_key
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload file to S3: {str(e)}"
        )


    # -----------------------------------------------------
    # Save metadata to PostgreSQL
    # -----------------------------------------------------

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

        # Upload sudah terjadi tetapi metadata gagal.
        # Hapus object agar tidak menjadi orphan object.
        try:
            delete_from_s3(
                result["bucket"],
                result["object"]
            )
        except Exception:
            pass

        raise HTTPException(
            status_code=500,
            detail=f"Metadata insert failed: {str(e)}"
        )

    finally:

        cur.close()
        conn.close()


# =========================================================
# DOCUMENT - LIST METADATA
# =========================================================

@app.get("/documents")
def get_documents():

    conn = db_connect()
    cur = conn.cursor()

    try:

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

    finally:

        cur.close()
        conn.close()


# =========================================================
# DOCUMENT - VERIFY DATABASE VS S3
# =========================================================

@app.get("/documents/verify")
def verify_documents():

    conn = db_connect()
    cur = conn.cursor()

    try:

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

    finally:

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

            s3_status = (
                f"ERROR: {str(e)}"
            )

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
# DOCUMENT - DOWNLOAD
# =========================================================

@app.get(
    "/documents/{document_id}/download"
)
def download_document(
    document_id: int
):

    conn = db_connect()
    cur = conn.cursor()

    try:

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


    finally:

        cur.close()
        conn.close()


    # -----------------------------------------------------
    # Get object from Ceph RGW
    # -----------------------------------------------------

    try:

        s3_object = download_from_s3(
            bucket,
            object_key
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to download object from S3: {str(e)}"
        )


    body = s3_object["Body"]


    content_type = s3_object.get(
        "ContentType",
        "application/octet-stream"
    )


    encoded_filename = quote(
        filename
    )


    # Stream object instead of loading
    # entire file into backend memory
    def file_iterator():

        try:

            for chunk in body.iter_chunks(
                chunk_size=8192
            ):

                if chunk:
                    yield chunk

        finally:

            body.close()


    return StreamingResponse(
        file_iterator(),
        media_type=content_type,
        headers={
            "Content-Disposition":
                f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )


# =========================================================
# DOCUMENT - RENAME
# =========================================================

@app.put(
    "/documents/{document_id}/rename"
)
def rename_document(
    document_id: int,
    new_filename: str
):

    new_filename = new_filename.strip()


    if not new_filename:

        raise HTTPException(
            status_code=400,
            detail="New filename cannot be empty"
        )


    conn = db_connect()
    cur = conn.cursor()


    try:

        # -------------------------------------------------
        # Get existing metadata
        # -------------------------------------------------

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


        old_filename = row[0]
        bucket = row[1]
        old_object_key = row[2]


        # -------------------------------------------------
        # Generate new object key
        # -------------------------------------------------

        new_object_key = (
            f"{uuid.uuid4()}-{new_filename}"
        )


        # -------------------------------------------------
        # Rename S3 object
        #
        # S3 does not have native rename.
        # Operation:
        #
        # old object
        #     ↓ COPY
        # new object
        #     ↓
        # delete old object
        # -------------------------------------------------

        try:

            rename_s3_object(
                bucket,
                old_object_key,
                new_object_key
            )

        except Exception as e:

            raise HTTPException(
                status_code=500,
                detail=f"Failed to rename S3 object: {str(e)}"
            )


        # -------------------------------------------------
        # Update PostgreSQL metadata
        # -------------------------------------------------

        try:

            cur.execute(
                """
                UPDATE documents
                SET
                    filename = %s,
                    object_key = %s
                WHERE id = %s
                """,
                (
                    new_filename,
                    new_object_key,
                    document_id
                )
            )


            conn.commit()


        except Exception as e:

            conn.rollback()

            raise HTTPException(
                status_code=500,
                detail=f"S3 object renamed but database update failed: {str(e)}"
            )


        return {
            "status": "renamed",

            "id": document_id,

            "old_filename":
                old_filename,

            "new_filename":
                new_filename,

            "bucket":
                bucket,

            "old_object_key":
                old_object_key,

            "new_object_key":
                new_object_key
        }


    except HTTPException:

        conn.rollback()
        raise


    except Exception as e:

        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to rename document: {str(e)}"
        )


    finally:

        cur.close()
        conn.close()


# =========================================================
# DOCUMENT - DELETE
# =========================================================

@app.delete(
    "/documents/{document_id}"
)
def delete_document(
    document_id: int
):

    conn = db_connect()
    cur = conn.cursor()


    try:

        # -------------------------------------------------
        # Get document metadata
        # -------------------------------------------------

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


        # -------------------------------------------------
        # Delete actual object from Ceph RGW
        # -------------------------------------------------

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


        # -------------------------------------------------
        # Delete metadata from PostgreSQL
        # -------------------------------------------------

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