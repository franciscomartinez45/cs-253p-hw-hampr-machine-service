import { DataCache } from "../database/cache";
import { MachineStateTable } from "../database/table";
import { IdentityProviderClient } from "../external/idp";
import { SmartMachineClient } from "../external/smart-machine";
import {
  GetMachineRequestModel,
  HttpResponseCode,
  MachineResponseModel,
  RequestMachineRequestModel,
  RequestModel,
  StartMachineRequestModel,
} from "./model";
import { MachineStateDocument, MachineStatus } from "../database/schema";
/**
 * Handles API requests for machine operations.
 * This class is responsible for routing requests to the appropriate handlers
 * and managing the overall workflow of machine interactions.
 */
export class ApiHandler {
  private cache: DataCache<MachineStateDocument>;
  constructor() {
    this.cache = DataCache.getInstance<MachineStateDocument>();
  }

  /**
   * Validates an authentication token.
   * @param token The token to validate.
   * @throws An error if the token is invalid.
   */
  private checkToken(token: string) {
    if (token == "invalid-token") {
      throw new Error(
        JSON.stringify({
          statusCode: HttpResponseCode.UNAUTHORIZED,
          message: "Invalid token",
        })
      );
    }
  }

  /**
   * Handles a request to find and reserve an available machine at a specific location.
   * It finds an available machine, updates its status to AWAITING_DROPOFF,
   * assigns the job ID, and caches the updated machine state.
   * NOTE: The current implementation assumes a machine will be held for a certain period,
   * but there is no mechanism to release the hold if the user doesn't proceed.
   * @param request The request model containing location and job IDs.
   * @returns A response model with the status code and the reserved machine's state.
   */

  private handleRequestMachine(
    request: RequestMachineRequestModel
  ): MachineResponseModel {
    const machinesTable = MachineStateTable.getInstance();
    const machinesAtLocation: MachineStateDocument[] =
      machinesTable.listMachinesAtLocation(request.locationId);

    if (machinesAtLocation.length !== 0) {
      const availableMachines: MachineStateDocument[] =
        machinesAtLocation.filter(
          (machine) => machine.status == MachineStatus.AVAILABLE
        );
      if (availableMachines.length !== 0) {
        const nextAvailable = availableMachines[0] as MachineStateDocument;
        const updateMachineJobId = machinesTable.updateMachineJobId(
          nextAvailable.machineId,
          request.jobId
        );
        const updateMachineStatus = machinesTable.updateMachineStatus(
          nextAvailable.machineId,
          MachineStatus.AWAITING_DROPOFF
        );
        const updatedMachine = machinesTable.getMachine(
          nextAvailable.machineId
        );
        if (updatedMachine) {
          const updateCache = DataCache.getInstance().put(
            updatedMachine.machineId,
            updatedMachine
          );
          const response = {
            statusCode: HttpResponseCode.OK,
            machine: updatedMachine,
          };
          return response;
        }
      }
    }
    const tempMachine: MachineStateDocument = {
      machineId: "",
      locationId: "",
      currentJobId: null,
      status: MachineStatus.ERROR,
    };
    const response = {
      statusCode: HttpResponseCode.NOT_FOUND,
      machines: tempMachine,
    };
    return response;

    // RequestMachineRequestModel(input)
    // locationId: string,
    // jobId: string

    // MachineResponseModel(return)
    // statusCode: HttpResponseCode,
    // machine?: MachineStateDocument
  }
  /**
   * Retrieves the state of a specific machine.
   * It first checks the cache for the machine's data and, if not found, fetches it from the database.
   * @param request The request model containing the machine ID.
   * @returns A response model with the status code and the machine's state.
   */
  private handleGetMachine(
    request: GetMachineRequestModel
  ): MachineResponseModel {
    //check the cache
    const cachedMachine = this.cache.get(
      request.machineId
    ) as MachineStateDocument;
    //console.log(cachedMachine);
    if (cachedMachine) {
      //console.log("Checking Cache");
      const response = {
        statusCode: HttpResponseCode.OK,
        machine: cachedMachine,
      };
      return response;
    }
    const database = MachineStateTable.getInstance();
    const databaseMachine = database.getMachine(request.machineId);
    if (databaseMachine) {
      const cacheMachine = this.cache.put(
        databaseMachine.machineId,
        databaseMachine
      );
      const response = {
        statusCode: HttpResponseCode.OK,
        machine: databaseMachine,
      };
      return response;
    } else {
      const tempMachine: MachineStateDocument = {
        machineId: "",
        locationId: "",
        currentJobId: null,
        status: MachineStatus.ERROR,
      };
      const response = {
        statusCode: HttpResponseCode.NOT_FOUND,
        machine: tempMachine,
      };
      return response;
    }

    // GetMachineRequestModel(input)
    // machineId: string

    // MachineResponseModel(return)
    // statusCode: HttpResponseCode,
    // machine?: MachineStateDocument
  }

  /**
   * Starts the cycle of a machine that is awaiting drop-off.
   * It validates the machine's status, calls the external Smart Machine API to start the cycle,
   * and updates the machine's status to RUNNING.
   * @param request The request model containing the machine ID.
   * @returns A response model with the status code and the updated machine's state.
   */
  private handleStartMachine(
    request: StartMachineRequestModel
  ): MachineResponseModel {
    const machineTable = MachineStateTable.getInstance();
    const machine = machineTable.getMachine(request.machineId);
    const tempMachine: MachineStateDocument = {
      machineId: "",
      locationId: "",
      currentJobId: null,
      status: MachineStatus.ERROR,
    };
    if (!machine) {
      const response = {
        statusCode: HttpResponseCode.NOT_FOUND,
        machine: tempMachine,
      };
      return response;
    }

    if (machine?.status != MachineStatus.AWAITING_DROPOFF) {
      const response = {
        statusCode: HttpResponseCode.BAD_REQUEST,
        machine: machine,
      };
      return response;
    }
    try {
      const updateMachineStatus = SmartMachineClient.getInstance().startCycle(
        machine.machineId
      );
      const updateMachineStatusTable = machineTable.updateMachineStatus(
        machine.machineId,
        MachineStatus.RUNNING
      );
      const updatedMachine = machineTable.getMachine(machine.machineId);
      if (updatedMachine) {
        const updateCache = this.cache.put(machine.machineId, updatedMachine);
      }
      const response = {
        statusCode: HttpResponseCode.OK,
        machine: updatedMachine,
      };
      return response;
    } catch (Error) {
      const updateError = machineTable.updateMachineStatus(
        machine.machineId,
        MachineStatus.ERROR
      );
      const errorMachine = machineTable.getMachine(machine.machineId);
      if (errorMachine) {
        const errorCache = this.cache.put(machine.machineId, errorMachine);
      }
      const response = {
        statusCode: HttpResponseCode.HARDWARE_ERROR,
        machine: errorMachine,
      };
      return response;
    }
  }

  /**
   * The main entry point for handling all API requests.
   * It validates the token and routes the request to the appropriate private handler based on the method and path.
   * @param request The incoming request model.
   * @returns A response model from one of the specific handlers, or an error response.
   */
  public handle(request: RequestModel) {
    this.checkToken(request.token);

    if (request.method === "POST" && request.path === "/machine/request") {
      return this.handleRequestMachine(request as RequestMachineRequestModel);
    }

    const getMachineMatch = request.path.match(/^\/machine\/([a-zA-Z0-9-]+)$/);
    if (request.method === "GET" && getMachineMatch) {
      const machineId = getMachineMatch[1];
      const getRequest = { ...request, machineId } as GetMachineRequestModel;
      return this.handleGetMachine(getRequest);
    }

    const startMachineMatch = request.path.match(
      /^\/machine\/([a-zA-Z0-9-]+)\/start$/
    );
    if (request.method === "POST" && startMachineMatch) {
      const machineId = startMachineMatch[1];
      const startRequest = {
        ...request,
        machineId,
      } as StartMachineRequestModel;
      return this.handleStartMachine(startRequest);
    }

    return {
      statusCode: HttpResponseCode.INTERNAL_SERVER_ERROR,
      machine: null,
    };
  }
}
