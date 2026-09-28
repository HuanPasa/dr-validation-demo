import { useEffect, useState } from "react";

const API_URL =
  "http://backend-dr-demo.apps.bpsocp.beint.local";

function App() {
  const [health, setHealth] = useState({
    application: "Loading",
    database: "Loading",
    s3: "Loading",
  });

  const [customers, setCustomers] = useState([]);
  const [documents, setDocuments] = useState([]);

  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
  });

  const [editingId, setEditingId] = useState(null);

  const [file, setFile] = useState(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");


  // =========================================================
  // API HELPER
  // =========================================================

  const request = async (url, options = {}) => {
    const response = await fetch(url, options);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;

      try {
        const errorData = await response.json();

        if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      } catch {
        errorMessage =
          `${response.status} ${response.statusText}`;
      }

      throw new Error(errorMessage);
    }

    return response.json();
  };


  // =========================================================
  // HEALTH
  // =========================================================

  const loadHealth = async () => {
    try {
      const data = await request(
        `${API_URL}/health`
      );

      setHealth(data);

    } catch (error) {
      console.error(error);

      setHealth({
        application: "FAILED",
        database: "FAILED",
        s3: "FAILED",
      });
    }
  };


  // =========================================================
  // LOAD CUSTOMERS
  // =========================================================

  const loadCustomers = async () => {
    try {
      const data = await request(
        `${API_URL}/customer`
      );

      setCustomers(data);

    } catch (error) {
      console.error(error);
    }
  };


  // =========================================================
  // LOAD DOCUMENTS + VERIFY S3
  // =========================================================

  const loadDocuments = async () => {
    try {
      const data = await request(
        `${API_URL}/documents/verify`
      );

      setDocuments(data);

    } catch (error) {
      console.error(error);
    }
  };


  // =========================================================
  // INITIAL LOAD
  // =========================================================

  useEffect(() => {
    loadHealth();
    loadCustomers();
    loadDocuments();
  }, []);


  // =========================================================
  // FORM HANDLING
  // =========================================================

  const handleInput = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };


  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      company: "",
    });

    setEditingId(null);
  };


  // =========================================================
  // CREATE CUSTOMER
  // =========================================================

  const createCustomer = async () => {
    if (
      !form.name ||
      !form.email ||
      !form.company
    ) {
      setMessage(
        "Please complete all customer fields."
      );

      return;
    }

    try {
      setLoading(true);

      const params = new URLSearchParams({
        name: form.name,
        email: form.email,
        company: form.company,
      });

      await request(
        `${API_URL}/customer?${params.toString()}`,
        {
          method: "POST",
        }
      );

      setMessage(
        "Customer created successfully."
      );

      resetForm();

      await loadCustomers();

    } catch (error) {
      setMessage(
        `Create failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // START EDIT CUSTOMER
  // =========================================================

  const startEdit = (customer) => {
    setEditingId(customer.id);

    setForm({
      name: customer.name,
      email: customer.email,
      company: customer.company,
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };


  // =========================================================
  // UPDATE CUSTOMER
  // =========================================================

  const updateCustomer = async () => {
    if (
      !form.name ||
      !form.email ||
      !form.company
    ) {
      setMessage(
        "Please complete all customer fields."
      );

      return;
    }

    try {
      setLoading(true);

      const params = new URLSearchParams({
        name: form.name,
        email: form.email,
        company: form.company,
      });

      await request(
        `${API_URL}/customer/${editingId}?${params.toString()}`,
        {
          method: "PUT",
        }
      );

      setMessage(
        "Customer updated successfully."
      );

      resetForm();

      await loadCustomers();

    } catch (error) {
      setMessage(
        `Update failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // DELETE CUSTOMER
  // =========================================================

  const deleteCustomer = async (id) => {
    const confirmed = window.confirm(
      `Delete customer ID ${id}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);

      await request(
        `${API_URL}/customer/${id}`,
        {
          method: "DELETE",
        }
      );

      setMessage(
        `Customer ID ${id} deleted successfully.`
      );

      await loadCustomers();

    } catch (error) {
      setMessage(
        `Delete customer failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // UPLOAD DOCUMENT
  // =========================================================

  const uploadDocument = async () => {
    if (!file) {
      setMessage(
        "Please select a file first."
      );

      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();

      formData.append(
        "file",
        file
      );

      await request(
        `${API_URL}/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      setMessage(
        `${file.name} uploaded successfully to Ceph RGW.`
      );

      setFile(null);

      const fileInput =
        document.getElementById("fileInput");

      if (fileInput) {
        fileInput.value = "";
      }

      await loadDocuments();
      await loadHealth();

    } catch (error) {
      setMessage(
        `Upload failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // DOWNLOAD DOCUMENT
  // =========================================================

  const downloadDocument = (id) => {
    const downloadUrl =
      `${API_URL}/documents/${id}/download`;

    const link =
      document.createElement("a");

    link.href = downloadUrl;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);
  };


  // =========================================================
  // RENAME DOCUMENT
  // =========================================================

  const renameDocument = async (
    id,
    currentFilename
  ) => {
    const newFilename = window.prompt(
      "Enter new filename:",
      currentFilename
    );

    if (newFilename === null) {
      return;
    }

    const cleanFilename =
      newFilename.trim();

    if (!cleanFilename) {
      setMessage(
        "New filename cannot be empty."
      );

      return;
    }

    if (
      cleanFilename === currentFilename
    ) {
      return;
    }

    try {
      setLoading(true);

      const params =
        new URLSearchParams({
          new_filename:
            cleanFilename,
        });

      await request(
        `${API_URL}/documents/${id}/rename?${params.toString()}`,
        {
          method: "PUT",
        }
      );

      setMessage(
        `"${currentFilename}" renamed to "${cleanFilename}".`
      );

      await loadDocuments();

    } catch (error) {
      setMessage(
        `Rename failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // DELETE DOCUMENT
  // =========================================================

  const deleteDocument = async (
    id,
    filename
  ) => {
    const confirmed =
      window.confirm(
        `Delete "${filename}"?\n\nThis will delete the object from Ceph RGW and remove its metadata from PostgreSQL.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);

      await request(
        `${API_URL}/documents/${id}`,
        {
          method: "DELETE",
        }
      );

      setMessage(
        `${filename} deleted successfully from S3 and PostgreSQL.`
      );

      await loadDocuments();
      await loadHealth();

    } catch (error) {
      setMessage(
        `Delete document failed: ${error.message}`
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // REFRESH ALL
  // =========================================================

  const refreshAll = async () => {
    try {
      setLoading(true);

      await Promise.all([
        loadHealth(),
        loadCustomers(),
        loadDocuments(),
      ]);

      setMessage(
        "Application data refreshed."
      );

    } finally {
      setLoading(false);
    }
  };


  // =========================================================
  // STATUS HELPER
  // =========================================================

  const isConnected = (value) =>
    value === "CONNECTED";


  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="app-shell">

      {/* =====================================================
          HEADER
      ====================================================== */}

      <div className="hero-section">

        <div className="container">

          <div className="d-flex justify-content-between align-items-center">

            <div>

              <div className="small text-uppercase hero-label">
                OpenShift Application Validation
              </div>

              <h1 className="fw-bold mb-1">
                DR Validation Portal
              </h1>

              <p className="mb-0 hero-subtitle">
                Container Application • PostgreSQL VM • Ceph RGW
              </p>

            </div>


            <div className="text-end">

              <span className="badge rounded-pill bg-success fs-6">
                PRIMARY SITE
              </span>

            </div>

          </div>

        </div>

      </div>


      {/* =====================================================
          CONTENT
      ====================================================== */}

      <div className="container py-4">


        {/* MESSAGE */}

        {message && (

          <div className="alert alert-info alert-dismissible fade show">

            {message}

            <button
              type="button"
              className="btn-close"
              onClick={() =>
                setMessage("")
              }
            />

          </div>

        )}


        {/* STATUS HEADER */}

        <div className="d-flex justify-content-between align-items-center mb-3">

          <div>

            <h5 className="fw-bold mb-1">
              Infrastructure Status
            </h5>

            <div className="text-muted small">
              Live connectivity validation
            </div>

          </div>


          <button
            className="btn btn-outline-primary btn-sm"
            onClick={refreshAll}
            disabled={loading}
          >
            Refresh All
          </button>

        </div>


        {/* STATUS CARDS */}

        <div className="row g-3 mb-4">

          <StatusCard
            title="Application"
            subtitle="FastAPI Backend"
            status={
              health.application ===
              "DR Validation Backend"
                ? "RUNNING"
                : health.application
            }
            healthy={
              health.application ===
              "DR Validation Backend"
            }
          />


          <StatusCard
            title="Database"
            subtitle="PostgreSQL VM"
            status={health.database}
            healthy={
              isConnected(
                health.database
              )
            }
          />


          <StatusCard
            title="Object Storage"
            subtitle="Ceph RGW S3"
            status={health.s3}
            healthy={
              isConnected(
                health.s3
              )
            }
          />

        </div>


        {/* ===================================================
            CUSTOMER SECTION
        ==================================================== */}

        <div className="row g-4">


          {/* CUSTOMER FORM */}

          <div className="col-lg-4">

            <div className="card border-0 shadow-sm h-100">

              <div className="card-body p-4">

                <h5 className="fw-bold mb-1">

                  {editingId
                    ? "Edit Customer"
                    : "Add Customer"}

                </h5>


                <p className="text-muted small mb-4">
                  PostgreSQL transaction validation
                </p>


                <label className="form-label">
                  Name
                </label>

                <input
                  className="form-control mb-3"
                  name="name"
                  value={form.name}
                  onChange={handleInput}
                  placeholder="Customer name"
                />


                <label className="form-label">
                  Email
                </label>

                <input
                  className="form-control mb-3"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleInput}
                  placeholder="customer@example.com"
                />


                <label className="form-label">
                  Company
                </label>

                <input
                  className="form-control mb-4"
                  name="company"
                  value={form.company}
                  onChange={handleInput}
                  placeholder="Company"
                />


                {!editingId ? (

                  <button
                    className="btn btn-primary w-100"
                    onClick={createCustomer}
                    disabled={loading}
                  >
                    Create Customer
                  </button>

                ) : (

                  <div className="d-flex gap-2">

                    <button
                      className="btn btn-primary flex-fill"
                      onClick={updateCustomer}
                      disabled={loading}
                    >
                      Save Changes
                    </button>


                    <button
                      className="btn btn-outline-secondary"
                      onClick={resetForm}
                      disabled={loading}
                    >
                      Cancel
                    </button>

                  </div>

                )}

              </div>

            </div>

          </div>


          {/* CUSTOMER TABLE */}

          <div className="col-lg-8">

            <div className="card border-0 shadow-sm">

              <div className="card-body p-4">

                <div className="d-flex justify-content-between align-items-center mb-3">

                  <div>

                    <h5 className="fw-bold mb-1">
                      Customer Records
                    </h5>

                    <div className="text-muted small">

                      {customers.length}
                      {" "}
                      record(s) in PostgreSQL

                    </div>

                  </div>


                  <button
                    className="btn btn-outline-primary btn-sm"
                    onClick={loadCustomers}
                    disabled={loading}
                  >
                    Refresh
                  </button>

                </div>


                <div className="table-responsive">

                  <table className="table align-middle">

                    <thead>

                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Company</th>

                        <th className="text-end">
                          Action
                        </th>
                      </tr>

                    </thead>


                    <tbody>

                      {customers.length === 0 ? (

                        <tr>

                          <td
                            colSpan="5"
                            className="text-center text-muted py-4"
                          >
                            No customer records
                          </td>

                        </tr>

                      ) : (

                        customers.map(
                          (customer) => (

                            <tr key={customer.id}>

                              <td>

                                <span className="id-badge">
                                  {customer.id}
                                </span>

                              </td>


                              <td className="fw-semibold">
                                {customer.name}
                              </td>


                              <td>
                                {customer.email}
                              </td>


                              <td>
                                {customer.company}
                              </td>


                              <td className="text-end">

                                <button
                                  className="btn btn-outline-primary btn-sm me-2"
                                  onClick={() =>
                                    startEdit(
                                      customer
                                    )
                                  }
                                  disabled={loading}
                                >
                                  Edit
                                </button>


                                <button
                                  className="btn btn-outline-danger btn-sm"
                                  onClick={() =>
                                    deleteCustomer(
                                      customer.id
                                    )
                                  }
                                  disabled={loading}
                                >
                                  Delete
                                </button>

                              </td>

                            </tr>

                          )
                        )

                      )}

                    </tbody>

                  </table>

                </div>

              </div>

            </div>

          </div>

        </div>


        {/* ===================================================
            DOCUMENT SECTION
        ==================================================== */}

        <div className="card border-0 shadow-sm mt-4">

          <div className="card-body p-4">


            {/* DOCUMENT HEADER */}

            <div className="row align-items-center mb-4">

              <div className="col-lg-6">

                <h5 className="fw-bold mb-1">
                  Document Validation
                </h5>

                <p className="text-muted small mb-0">
                  PostgreSQL metadata vs Ceph RGW object availability
                </p>

              </div>


              <div className="col-lg-6 mt-3 mt-lg-0">

                <div className="input-group">

                  <input
                    id="fileInput"
                    type="file"
                    className="form-control"
                    onChange={(event) =>
                      setFile(
                        event.target.files[0]
                      )
                    }
                    disabled={loading}
                  />


                  <button
                    className="btn btn-success"
                    onClick={uploadDocument}
                    disabled={loading}
                  >
                    Upload to S3
                  </button>

                </div>

              </div>

            </div>


            {/* DOCUMENT TABLE */}

            <div className="table-responsive">

              <table className="table align-middle">

                <thead>

                  <tr>

                    <th>ID</th>

                    <th>
                      Filename
                    </th>

                    <th>
                      Bucket
                    </th>

                    <th>
                      Object Key
                    </th>

                    <th>
                      DB
                    </th>

                    <th>
                      S3
                    </th>

                    <th>
                      Consistency
                    </th>

                    <th className="text-end">
                      Action
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {documents.length === 0 ? (

                    <tr>

                      <td
                        colSpan="8"
                        className="text-center text-muted py-4"
                      >
                        No uploaded documents
                      </td>

                    </tr>

                  ) : (

                    documents.map(
                      (doc) => (

                        <tr key={doc.id}>

                          <td>
                            {doc.id}
                          </td>


                          <td className="fw-semibold">

                            {doc.filename}

                          </td>


                          <td>

                            {doc.bucket}

                          </td>


                          <td>

                            <code className="object-key">
                              {doc.object_key}
                            </code>

                          </td>


                          <td>

                            <span className="badge bg-success">
                              PRESENT
                            </span>

                          </td>


                          <td>

                            <span
                              className={
                                doc.s3_object
                                  ? "badge bg-success"
                                  : "badge bg-danger"
                              }
                            >

                              {doc.s3_object
                                ? "AVAILABLE"
                                : "MISSING"}

                            </span>

                          </td>


                          <td>

                            <span
                              className={
                                doc.status ===
                                "CONSISTENT"
                                  ? "badge bg-success"
                                  : "badge bg-danger"
                              }
                            >

                              {doc.status}

                            </span>

                          </td>


                          <td className="text-end">

                            <div className="d-flex justify-content-end gap-2 flex-wrap">


                              {/* DOWNLOAD */}

                              <button
                                className="btn btn-outline-success btn-sm"
                                onClick={() =>
                                  downloadDocument(
                                    doc.id
                                  )
                                }
                                disabled={
                                  loading ||
                                  !doc.s3_object
                                }
                              >
                                Download
                              </button>


                              {/* RENAME */}

                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() =>
                                  renameDocument(
                                    doc.id,
                                    doc.filename
                                  )
                                }
                                disabled={
                                  loading ||
                                  !doc.s3_object
                                }
                              >
                                Rename
                              </button>


                              {/* DELETE */}

                              <button
                                className="btn btn-outline-danger btn-sm"
                                onClick={() =>
                                  deleteDocument(
                                    doc.id,
                                    doc.filename
                                  )
                                }
                                disabled={loading}
                              >
                                Delete
                              </button>


                            </div>

                          </td>

                        </tr>

                      )
                    )

                  )}

                </tbody>

              </table>

            </div>


            {/* DOCUMENT FOOTER */}

            <div className="d-flex justify-content-between align-items-center mt-3">

              <div className="text-muted small">

                {documents.length}
                {" "}
                document(s) registered

              </div>


              <button
                className="btn btn-outline-primary btn-sm"
                onClick={loadDocuments}
                disabled={loading}
              >
                Verify Again
              </button>

            </div>

          </div>

        </div>


        {/* ===================================================
            FOOTER
        ==================================================== */}

        <div className="text-center text-muted small py-4">

          DR Validation Portal
          {" • "}
          OpenShift Container Platform

        </div>

      </div>

    </div>
  );
}


// =========================================================
// STATUS CARD
// =========================================================

function StatusCard({
  title,
  subtitle,
  status,
  healthy,
}) {

  return (

    <div className="col-md-4">

      <div className="card border-0 shadow-sm status-card h-100">

        <div className="card-body">

          <div className="d-flex justify-content-between">

            <div>

              <div className="text-muted small">
                {subtitle}
              </div>

              <h5 className="fw-bold mt-1 mb-2">
                {title}
              </h5>

              <span
                className={
                  healthy
                    ? "badge bg-success"
                    : "badge bg-danger"
                }
              >

                ● {status}

              </span>

            </div>


            <div
              className={
                healthy
                  ? "status-indicator healthy"
                  : "status-indicator unhealthy"
              }
            />

          </div>

        </div>

      </div>

    </div>

  );
}


export default App;