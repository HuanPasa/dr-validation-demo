import boto3
import os

from botocore.config import Config
from botocore.exceptions import ClientError


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        config=Config(
            signature_version="s3v4",
            s3={
                "addressing_style": "path"
            }
        )
    )


def upload_to_s3(file, object_key):
    s3 = get_s3_client()

    bucket = os.getenv("S3_BUCKET")

    s3.upload_fileobj(
        file,
        bucket,
        object_key
    )

    return {
        "bucket": bucket,
        "object": object_key
    }


def object_exists(bucket, object_key):
    s3 = get_s3_client()

    try:
        s3.head_object(
            Bucket=bucket,
            Key=object_key
        )

        return True

    except ClientError as e:
        error_code = e.response.get(
            "Error", {}
        ).get("Code")

        if error_code in [
            "404",
            "NoSuchKey",
            "NotFound"
        ]:
            return False

        raise


def check_bucket():
    s3 = get_s3_client()

    bucket = os.getenv("S3_BUCKET")

    s3.head_bucket(
        Bucket=bucket
    )

    return True