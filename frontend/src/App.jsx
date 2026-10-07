import {
  useEffect,
  useRef,
  useState
} from "react";


// =========================================================
// RUNTIME CONFIG
// =========================================================

const API_URL = (
  window.RUNTIME_CONFIG?.API_URL || ""
).replace(/\/+$/, "");


// =========================================================
// APPLICATION
// =========================================================

function App() {

  // =========================================================
  // STATE
  // =========================================================

  const [health, setHealth] = useState({
    application: "Loading",
    site: "UNKNOWN",
    database: "Loading",
    db_host: "UNKNOWN",
    db_name: "UNKNOWN",
    s3: "Loading",
  });


  const [customers, setCustomers] =
    useState([]);

  const [documents, setDocuments] =
    useState([]);


  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
  });


  const [editingId, setEditingId] =
    useState(null);


  const [file, setFile] =
    useState(null);


  const [loading, setLoading] =
    useState(false);


  const [message, setMessage] =
    useState("");


  // Menyimpan status health sebelumnya.
  // Dipakai supaya customer/document tidak
  // direload setiap 5 detik.

  const previousHealthRef = useRef({
    database: null,
    s3: null,
  });


  // =========================================================
  // API HELPER
  // =========================================================

  const request = async (
    url,
    options = {}
  ) => {

    if (!API_URL) {

      throw new Error(
        "Backend API URL is not configured."
      );
    }


    const response = await fetch(
      url,
      {
        cache: "no-store",
        ...options,
      }
    );


    if (!response.ok) {

      let errorMessage =
        `HTTP ${response.status}`;


      try {

        const errorData =
          await response.json();


        if (errorData.detail) {

          errorMessage =
            errorData.detail;
        }

      } catch {

        errorMessage =
          `${response.status} ${response.statusText}`;
      }


      throw new Error(
        errorMessage
      );
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


      return data;

    } catch (error) {

      console.error(
        "Health check failed:",
        error
      );


      const failedHealth = {

        application: "FAILED",

        site: "UNKNOWN",

        database: "FAILED",

        db_host: "UNKNOWN",

        db_name: "UNKNOWN",

        s3: "FAILED",
      };


      setHealth(
        failedHealth
      );


      return failedHealth;
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


      setCustomers(
        data
      );

    } catch (error) {

      console.error(
        "Load customers failed:",
        error
      );
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


      setDocuments(
        data
      );

    } catch (error) {

      console.error(
        "Load documents failed:",
        error
      );
    }
  };


  // =========================================================
  // AUTOMATIC HEALTH CHECK
  //
  // Setiap 5 detik:
  //
  // HANYA:
  // GET /health
  //
  // Customer + documents hanya reload ketika:
  //
  // - DB baru berubah menjadi CONNECTED
  // - S3 baru berubah menjadi CONNECTED
  // - User klik refresh
  // - User melakukan transaksi
  //
  // =========================================================

  useEffect(() => {

    let active = true;

    let checking = false;


    const checkApplication = async () => {

      // Cegah request health bertumpuk
      // kalau request sebelumnya belum selesai.

      if (checking) {
        return;
      }


      checking = true;


      try {

        const currentHealth =
          await loadHealth();


        if (!active) {
          return;
        }


        const databaseConnected =
          currentHealth.database ===
          "CONNECTED";


        const s3Connected =
          currentHealth.s3 ===
          "CONNECTED";


        const previousDatabase =
          previousHealthRef.current
            .database;


        const previousS3 =
          previousHealthRef.current
            .s3;


        // -------------------------------------------------
        // DATABASE DOWN
        // -------------------------------------------------

        if (!databaseConnected) {

          setCustomers([]);

          setDocuments([]);

          setEditingId(null);
        }


        // -------------------------------------------------
        // DATABASE BARU CONNECT
        // -------------------------------------------------

        if (
          databaseConnected &&
          previousDatabase !== "CONNECTED"
        ) {

          await loadCustomers();


          if (s3Connected) {

            await loadDocuments();

          } else {

            setDocuments([]);
          }
        }


        // -------------------------------------------------
        // S3 BARU CONNECT
        //
        // DB tetap connected, tetapi S3 sebelumnya down.
        // Saat S3 kembali normal, refresh documents sekali.
        // -------------------------------------------------

        if (
          databaseConnected &&
          s3Connected &&
          previousDatabase === "CONNECTED" &&
          previousS3 !== "CONNECTED"
        ) {

          await loadDocuments();
        }


        // -------------------------------------------------
        // STORE CURRENT STATUS
        // -------------------------------------------------

        previousHealthRef.current = {

          database:
            currentHealth.database,

          s3:
            currentHealth.s3,
        };

      } finally {

        checking = false;
      }
    };


    // Check langsung saat halaman dibuka

    checkApplication();


    // Check health setiap 5 detik

    const interval = setInterval(
      checkApplication,
      5000
    );


    return () => {

      active = false;

      clearInterval(
        interval
      );
    };

  }, []);


  // =========================================================
  // STATUS
  // =========================================================

  const backendReady =
    health.application ===
    "DR Validation Backend";


  const databaseReady =
    health.database ===
    "CONNECTED";


  const s3Ready =
    health.s3 ===
    "CONNECTED";


  // Application dianggap aktif apabila:
  //
  // Backend = Running
  // Database = Connected
  //
  // S3 tidak menjadi syarat supaya aplikasi
  // tidak masuk standby hanya karena object
  // storage bermasalah.

  const applicationReady =
    backendReady &&
    databaseReady;


  const siteName =
    health.site &&
    health.site !== "UNKNOWN"
      ? health.site
      : "UNKNOWN";


  // =========================================================
  // FORM HANDLING
  // =========================================================

  const handleInput = (event) => {

    setForm({

      ...form,

      [event.target.name]:
        event.target.value,
    });
  };


  const resetForm = () => {

    setForm({

      name: "",

      email: "",

      company: "",
    });


    setEditingId(
      null
    );
  };


  // =========================================================
  // CREATE CUSTOMER
  // =========================================================

  const createCustomer = async () => {

    if (!databaseReady) {

      setMessage(
        "Database is not ready."
      );

      return;
    }


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

      setLoading(
        true
      );


      const params =
        new URLSearchParams({

          name:
            form.name,

          email:
            form.email,

          company:
            form.company,
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

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // EDIT CUSTOMER
  // =========================================================

  const startEdit = (
    customer
  ) => {

    setEditingId(
      customer.id
    );


    setForm({

      name:
        customer.name,

      email:
        customer.email,

      company:
        customer.company,
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

    if (!databaseReady) {

      setMessage(
        "Database is not ready."
      );

      return;
    }


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

      setLoading(
        true
      );


      const params =
        new URLSearchParams({

          name:
            form.name,

          email:
            form.email,

          company:
            form.company,
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

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // DELETE CUSTOMER
  // =========================================================

  const deleteCustomer = async (
    id
  ) => {

    if (!databaseReady) {

      setMessage(
        "Database is not ready."
      );

      return;
    }


    const confirmed =
      window.confirm(
        `Delete customer ID ${id}?`
      );


    if (!confirmed) {
      return;
    }


    try {

      setLoading(
        true
      );


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
        `Delete failed: ${error.message}`
      );

    } finally {

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // UPLOAD DOCUMENT
  // =========================================================

  const uploadDocument = async () => {

    if (!databaseReady) {

      setMessage(
        "Database is not ready."
      );

      return;
    }


    if (!s3Ready) {

      setMessage(
        "Object Storage is not ready."
      );

      return;
    }


    if (!file) {

      setMessage(
        "Please select a file first."
      );

      return;
    }


    try {

      setLoading(
        true
      );


      const formData =
        new FormData();


      formData.append(
        "file",
        file
      );


      await request(

        `${API_URL}/upload`,

        {
          method: "POST",

          body:
            formData,
        }
      );


      setMessage(
        `${file.name} uploaded successfully.`
      );


      setFile(
        null
      );


      const input =
        document.getElementById(
          "fileInput"
        );


      if (input) {

        input.value =
          "";
      }


      await loadDocuments();

    } catch (error) {

      setMessage(
        `Upload failed: ${error.message}`
      );

    } finally {

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // DOWNLOAD DOCUMENT
  // =========================================================

  const downloadDocument = (
    id
  ) => {

    if (
      !databaseReady ||
      !s3Ready
    ) {

      setMessage(
        "Document service is not ready."
      );

      return;
    }


    const link =
      document.createElement(
        "a"
      );


    link.href =
      `${API_URL}/documents/${id}/download`;


    document.body.appendChild(
      link
    );


    link.click();


    document.body.removeChild(
      link
    );
  };


  // =========================================================
  // RENAME DOCUMENT
  // =========================================================

  const renameDocument = async (
    id,
    currentFilename
  ) => {

    if (
      !databaseReady ||
      !s3Ready
    ) {

      setMessage(
        "Document service is not ready."
      );

      return;
    }


    const newFilename =
      window.prompt(

        "Enter new filename:",

        currentFilename
      );


    if (
      newFilename === null
    ) {

      return;
    }


    const cleanFilename =
      newFilename.trim();


    if (!cleanFilename) {

      setMessage(
        "Filename cannot be empty."
      );

      return;
    }


    if (
      cleanFilename ===
      currentFilename
    ) {

      return;
    }


    try {

      setLoading(
        true
      );


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

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // DELETE DOCUMENT
  // =========================================================

  const deleteDocument = async (
    id,
    filename
  ) => {

    if (
      !databaseReady ||
      !s3Ready
    ) {

      setMessage(
        "Document service is not ready."
      );

      return;
    }


    const confirmed =
      window.confirm(

        `Delete "${filename}"?\n\nThis will delete the S3 object and PostgreSQL metadata.`
      );


    if (!confirmed) {

      return;
    }


    try {

      setLoading(
        true
      );


      await request(

        `${API_URL}/documents/${id}`,

        {
          method: "DELETE",
        }
      );


      setMessage(
        `${filename} deleted successfully.`
      );


      await loadDocuments();

    } catch (error) {

      setMessage(
        `Delete failed: ${error.message}`
      );

    } finally {

      setLoading(
        false
      );
    }
  };


  // =========================================================
  // REFRESH ALL
  // =========================================================

  const refreshAll = async () => {

    try {

      setLoading(
        true
      );


      const currentHealth =
        await loadHealth();


      const dbConnected =
        currentHealth.database ===
        "CONNECTED";


      const objectStorageConnected =
        currentHealth.s3 ===
        "CONNECTED";


      if (!dbConnected) {

        setCustomers([]);

        setDocuments([]);


        setMessage(
          "Database is not ready. Application remains in standby mode."
        );


        return;
      }


      await loadCustomers();


      if (objectStorageConnected) {

        await loadDocuments();


        setMessage(
          "Application data refreshed."
        );

      } else {

        setDocuments([]);


        setMessage(
          "Application refreshed. Database is connected, but Object Storage is not ready."
        );
      }


      previousHealthRef.current = {

        database:
          currentHealth.database,

        s3:
          currentHealth.s3,
      };

    } catch (error) {

      setMessage(
        `Refresh failed: ${error.message}`
      );

    } finally {

      setLoading(
        false
      );
    }
  };


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

          <div className="d-flex justify-content-between align-items-center gap-3">

            <div>

              <div className="small text-uppercase hero-label">

                OpenShift Application Validation

              </div>


              <h1 className="fw-bold mb-1">

                DR Validation Portal

              </h1>


              <p className="mb-0 hero-subtitle">

                Container Application • PostgreSQL • S3 Storage

              </p>

            </div>


            <div className="text-end">


              <span
                className={
                  backendReady

                    ? "badge rounded-pill bg-success fs-6 site-badge"

                    : "badge rounded-pill bg-secondary fs-6 site-badge"
                }
              >

                {backendReady

                  ? `CONNECTED TO ${siteName}`

                  : "BACKEND NOT CONNECTED"}

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


        {/* ===================================================
            STATUS HEADER
        ==================================================== */}

        <div className="d-flex justify-content-between align-items-center mb-3 gap-3">

          <div>

            <h5 className="fw-bold mb-1">

              Infrastructure Status

            </h5>


            <div className="text-muted small">

              Live connectivity validation • Health check every 5 seconds

            </div>

          </div>


          <button
            className="btn btn-outline-primary btn-sm"
            onClick={refreshAll}
            disabled={loading}
          >

            {loading
              ? "Refreshing..."
              : "Refresh All"}

          </button>

        </div>


        {/* ===================================================
            STATUS CARDS
        ==================================================== */}

        <div className="row g-3 mb-4">


          <StatusCard

            title="Application"

            subtitle="FastAPI Backend"

            status={
              backendReady
                ? "RUNNING"
                : "NOT READY"
            }

            healthy={
              backendReady
            }

            details={[
              `Site: ${siteName}`,
            ]}
          />


          <StatusCard

            title="Database"

            subtitle="PostgreSQL"

            status={
              databaseReady
                ? "CONNECTED"
                : "NOT READY"
            }

            healthy={
              databaseReady
            }

            details={[
              `Host: ${health.db_host || "UNKNOWN"}`,
              `Database: ${health.db_name || "UNKNOWN"}`,
            ]}
          />


          <StatusCard

            title="Object Storage"

            subtitle="S3 Storage"

            status={
              s3Ready
                ? "CONNECTED"
                : "NOT READY"
            }

            healthy={
              s3Ready
            }
          />


        </div>


        {/* ===================================================
            STANDBY MODE
        ==================================================== */}

        {!applicationReady && (

          <div className="card standby-card shadow-sm mb-4">

            <div className="card-body text-center py-5 px-4">


              <div className="standby-icon mb-3">

                ⏳

              </div>


              <div className="standby-label mb-2">

                DISASTER RECOVERY STANDBY

              </div>


              <h2 className="fw-bold mb-3">

                Application Standby

              </h2>


              {!backendReady ? (

                <>

                  <p className="standby-description mb-2">

                    Backend service is currently unavailable.

                  </p>


                  <p className="text-muted mb-4">

                    Waiting for backend connectivity.

                  </p>


                  <span className="badge bg-danger standby-badge">

                    BACKEND NOT READY

                  </span>

                </>

              ) : (

                <>

                  <p className="standby-description mb-2">

                    Backend is running on {siteName}, but the database is not ready.

                  </p>


                  <div className="standby-db-info">

                    <div>

                      <span>
                        Target DB Host
                      </span>

                      <strong>
                        {health.db_host || "UNKNOWN"}
                      </strong>

                    </div>


                    <div>

                      <span>
                        Database
                      </span>

                      <strong>
                        {health.db_name || "UNKNOWN"}
                      </strong>

                    </div>

                  </div>


                  <p className="text-muted mb-4 mt-3">

                    Waiting for database activation and PostgreSQL connectivity.

                  </p>


                  <span className="badge bg-warning text-dark standby-badge">

                    DATABASE NOT READY

                  </span>

                </>

              )}


              <div className="standby-separator" />


              <div className="row justify-content-center g-3 mt-1">


                <StandbyDependency

                  title="Frontend"

                  status="RUNNING"

                  healthy={true}

                />


                <StandbyDependency

                  title="Backend"

                  status={
                    backendReady
                      ? `${siteName} RUNNING`
                      : "NOT READY"
                  }

                  healthy={
                    backendReady
                  }

                />


                <StandbyDependency

                  title="Database"

                  status={
                    databaseReady
                      ? "CONNECTED"
                      : "WAITING"
                  }

                  healthy={
                    databaseReady
                  }

                />


                <StandbyDependency

                  title="Object Storage"

                  status={
                    s3Ready
                      ? "CONNECTED"
                      : "NOT READY"
                  }

                  healthy={
                    s3Ready
                  }

                />


              </div>


              <div className="standby-auto-check mt-4">

                <span className="standby-pulse" />

                Connectivity is checked automatically every 5 seconds.

              </div>


            </div>

          </div>

        )}


        {/* ===================================================
            ACTIVE APPLICATION
        ==================================================== */}

        {applicationReady && (

          <>


            {/* ACTIVE BANNER */}

            <div className="active-banner mb-4">

              <div>

                <div className="fw-bold">

                  Application Active — {siteName}

                </div>


                <div className="small">

                  Connected to database {health.db_name || "UNKNOWN"} on {health.db_host || "UNKNOWN"}.

                </div>

              </div>


              <span className="badge bg-success fs-6">

                READY

              </span>

            </div>


            {/* =================================================
                CUSTOMER SECTION
            ================================================== */}

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

                      value={
                        form.name
                      }

                      onChange={
                        handleInput
                      }

                      placeholder="Customer name"

                    />


                    <label className="form-label">

                      Email

                    </label>


                    <input

                      className="form-control mb-3"

                      name="email"

                      type="email"

                      value={
                        form.email
                      }

                      onChange={
                        handleInput
                      }

                      placeholder="customer@example.com"

                    />


                    <label className="form-label">

                      Company

                    </label>


                    <input

                      className="form-control mb-4"

                      name="company"

                      value={
                        form.company
                      }

                      onChange={
                        handleInput
                      }

                      placeholder="Company"

                    />


                    {!editingId ? (

                      <button

                        className="btn btn-primary w-100"

                        onClick={
                          createCustomer
                        }

                        disabled={
                          loading
                        }
                      >

                        Create Customer

                      </button>

                    ) : (

                      <div className="d-flex gap-2">


                        <button

                          className="btn btn-primary flex-fill"

                          onClick={
                            updateCustomer
                          }

                          disabled={
                            loading
                          }
                        >

                          Save Changes

                        </button>


                        <button

                          className="btn btn-outline-secondary"

                          onClick={
                            resetForm
                          }

                          disabled={
                            loading
                          }
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

                          {customers.length} record(s) in PostgreSQL

                        </div>

                      </div>


                      <button

                        className="btn btn-outline-primary btn-sm"

                        onClick={
                          loadCustomers
                        }

                        disabled={
                          loading
                        }
                      >

                        Refresh

                      </button>


                    </div>


                    <div className="table-responsive">

                      <table className="table align-middle">


                        <thead>

                          <tr>

                            <th>
                              ID
                            </th>

                            <th>
                              Name
                            </th>

                            <th>
                              Email
                            </th>

                            <th>
                              Company
                            </th>

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

                                      disabled={
                                        loading
                                      }
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

                                      disabled={
                                        loading
                                      }
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


            {/* =================================================
                DOCUMENT SECTION
            ================================================== */}

            <div className="card border-0 shadow-sm mt-4">

              <div className="card-body p-4">


                <div className="row align-items-center mb-4">


                  <div className="col-lg-6">

                    <h5 className="fw-bold mb-1">

                      Document Validation

                    </h5>


                    <p className="text-muted small mb-0">

                      PostgreSQL metadata vs S3 object availability

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

                        disabled={
                          loading ||
                          !s3Ready
                        }

                      />


                      <button

                        className="btn btn-success"

                        onClick={
                          uploadDocument
                        }

                        disabled={
                          loading ||
                          !s3Ready
                        }
                      >

                        Upload to S3

                      </button>


                    </div>

                  </div>


                </div>


                {!s3Ready && (

                  <div className="alert alert-warning">

                    S3 Storage is not ready. Document operations are temporarily unavailable.

                  </div>

                )}


                <div className="table-responsive">

                  <table className="table align-middle">


                    <thead>

                      <tr>

                        <th>
                          ID
                        </th>

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

                            {s3Ready
                              ? "No uploaded documents"
                              : "Object Storage is not available"}

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


                                  <button

                                    className="btn btn-outline-success btn-sm"

                                    onClick={() =>
                                      downloadDocument(
                                        doc.id
                                      )
                                    }

                                    disabled={
                                      loading ||
                                      !s3Ready ||
                                      !doc.s3_object
                                    }
                                  >

                                    Download

                                  </button>


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
                                      !s3Ready ||
                                      !doc.s3_object
                                    }
                                  >

                                    Rename

                                  </button>


                                  <button

                                    className="btn btn-outline-danger btn-sm"

                                    onClick={() =>
                                      deleteDocument(
                                        doc.id,
                                        doc.filename
                                      )
                                    }

                                    disabled={
                                      loading ||
                                      !s3Ready
                                    }
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


                <div className="d-flex justify-content-between align-items-center mt-3 gap-3">


                  <div className="text-muted small">

                    {documents.length} document(s) registered

                  </div>


                  <button

                    className="btn btn-outline-primary btn-sm"

                    onClick={
                      loadDocuments
                    }

                    disabled={
                      loading ||
                      !s3Ready
                    }
                  >

                    Verify Again

                  </button>


                </div>


              </div>

            </div>


          </>

        )}


        {/* ===================================================
            FOOTER
        ==================================================== */}

        <div className="text-center text-muted small py-4">

          DR Validation Portal • OpenShift Container Platform

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
  details = [],
}) {

  return (

    <div className="col-md-4">

      <div className="card border-0 shadow-sm status-card h-100">

        <div className="card-body">


          <div className="d-flex justify-content-between gap-3">


            <div className="status-card-content">


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


              {details.length > 0 && (

                <div className="status-details">

                  {details.map(
                    (detail, index) => (

                      <div
                        key={index}
                        className="status-detail-item"
                      >

                        {detail}

                      </div>

                    )
                  )}

                </div>

              )}


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


// =========================================================
// STANDBY DEPENDENCY
// =========================================================

function StandbyDependency({
  title,
  status,
  healthy,
}) {

  return (

    <div className="col-6 col-md-3">

      <div className="standby-dependency">


        <div className="standby-dependency-title">

          {title}

        </div>


        <div
          className={
            healthy

              ? "standby-dependency-status healthy"

              : "standby-dependency-status waiting"
          }
        >


          <span
            className={
              healthy

                ? "dependency-dot healthy"

                : "dependency-dot waiting"
            }
          />


          {status}


        </div>


      </div>

    </div>
  );
}


export default App;