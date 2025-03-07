import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Model } from "mongoose";
import { DatablocksService } from "./datablocks.service";
import { Datablock } from "./schemas/datablock.schema";

const mockDatablock: Datablock = {
  _id: "testId",
  datasetId: "testPid",
  archiveId: "testArchiveId",
  size: 1000,
  packedSize: 1000,
  chkAlg: "testChkAlg",
  version: "testVersion",
  ownerGroup: "testOwner",
  accessGroups: ["testAccess"],
  createdBy: "testUser",
  updatedBy: "testUser",
  dataFileList: [
    {
      path: "testFile.hdf5",
      size: 1000,
      time: new Date(),
      chk: "testChk",
      uid: "testUid",
      gid: "testGid",
      perm: "testPerm",
    },
  ],
};

describe("DatablocksService", () => {
  let service: DatablocksService;
  let model: Model<Datablock>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatablocksService,
        {
          provide: getModelToken("Datablock"),
          useValue: {
            new: jest.fn().mockResolvedValue(mockDatablock),
            constructor: jest.fn().mockResolvedValue(mockDatablock),
            find: jest.fn(),
            create: jest.fn(),
            exec: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DatablocksService>(DatablocksService);
    model = module.get<Model<Datablock>>(getModelToken("Datablock"));
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
