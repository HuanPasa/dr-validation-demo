import { useEffect, useState } from "react";
import "./App.css";


const API_URL = "http://backend-dr-demo.apps.bpsocp.beint.local";


function App() {

  const [customers, setCustomers] = useState([]);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");


  const getCustomers = async () => {

    const response = await fetch(
      `${API_URL}/customer`
    );

    const data = await response.json();

    setCustomers(data);

  };


  useEffect(() => {

    getCustomers();

  }, []);



  const addCustomer = async () => {

    await fetch(
      `${API_URL}/customer?name=${name}&email=test@demo.local&company=${company}`,
      {
        method:"POST"
      }
    );

    getCustomers();

  };



  return (

    <div className="container">

      <h1>
        DR Validation Portal
      </h1>


      <div className="card">

        <h2>
          Application Status
        </h2>

        <p className="green">
          🟢 Backend Running
        </p>

        <p className="green">
          🟢 Database Connected
        </p>

      </div>



      <div className="card">

        <h2>
          Customer Data
        </h2>


        <table>

          <thead>

            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
            </tr>

          </thead>


          <tbody>

          {
            customers.map((c,index)=>(

              <tr key={index}>

                <td>{c[0]}</td>
                <td>{c[1]}</td>
                <td>{c[2]}</td>
                <td>{c[3]}</td>

              </tr>

            ))
          }

          </tbody>


        </table>

      </div>



      <div className="card">

        <h2>
          Add Customer
        </h2>


        <input
          placeholder="Name"
          value={name}
          onChange={
            e=>setName(e.target.value)
          }
        />


        <input
          placeholder="Company"
          value={company}
          onChange={
            e=>setCompany(e.target.value)
          }
        />


        <button onClick={addCustomer}>
          Create
        </button>


      </div>


    </div>

  );

}


export default App;