import {
  AbiRegistry,
  Address,
  ResultsParser,
  SmartContract,
} from "@multiversx/sdk-core/out";
import { ProxyNetworkProvider } from "@multiversx/sdk-network-providers/out";
const provider = new ProxyNetworkProvider("https://gateway.multiversx.com", {
  timeout: 10000,
});
export const scQuery = async (
  strAddress: string,
  abiUrl: any,
  funcName = "",
  args: any[] = []
) => {
  try {
    const address = new Address(strAddress);
    const abiRegistry = await AbiRegistry.create(abiUrl);
    const contract = new SmartContract({
      address: address,
      abi: abiRegistry,
    });

    let interaction = contract.methods[funcName](args);
    const query = interaction.check().buildQuery();
    const queryResponse = await provider.queryContract(query);

    const data = new ResultsParser().parseQueryResponse(
      queryResponse,
      interaction.getEndpoint()
    );

    return data;
  } catch (error) {
    console.log(`query error for ${funcName}  : , error`);
    throw error;
  }
};
